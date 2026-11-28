/**
 * google.ts — "Continue with Google" (OAuth 2.0 authorization code + PKCE,
 * OpenID Connect ID token).
 *
 *   GET /api/oauth/google/start     → redirect to Google's consent screen
 *   GET /api/oauth/google/callback  → verify state, exchange code, verify the
 *                                     ID token, find/create the user, sign in
 *
 * With ?app_challenge=… the flow was started by the RT Scanner app: instead of
 * a cookie, the callback hands a one-time code back to the app (app-handoff.ts).
 *
 * The state and PKCE verifier travel in a short-lived signed, HttpOnly cookie,
 * so no server-side session store is needed. The ID token's signature,
 * issuer, audience and expiry are verified against Google's published keys,
 * and only verified email addresses are accepted.
 */
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import * as jose from "jose";
import * as cookie from "cookie";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { env, googleSignInEnabled } from "../lib/env";
import { log } from "../lib/logger";
import { getDb } from "../queries/connection";
import { findUserByUnionId } from "../queries/users";
import { sessionSetCookie } from "./session-cookie";
import { appReturnPage, isAppChallenge, issueAppCode } from "./app-handoff";

type App = Hono<{ Bindings: HttpBindings }>;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_COOKIE = "rt_google_flow";
const FLOW_MAX_AGE = 10 * 60;

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;
const googleKeys = () => (jwks ??= jose.createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));
const secretKey = () => new TextEncoder().encode(env.appSecret);
const b64url = (buf: Buffer) => buf.toString("base64url");

export function redirectUri(c: Context): string {
  const base = env.publicUrl || new URL(c.req.url).origin;
  return `${base.replace(/\/+$/, "")}/api/oauth/google/callback`;
}

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

/** Verify a Google ID token and return the profile, or throw. Exported for tests. */
export async function verifyGoogleIdToken(idToken: string, keys: jose.JWTVerifyGetKey = googleKeys()): Promise<GoogleProfile> {
  const { payload } = await jose.jwtVerify(idToken, keys, { issuer: ISSUERS, audience: env.googleClientId });
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!payload.sub || !email) throw new Error("ID token missing subject or email");
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new Error("Google email is not verified");
  return {
    sub: String(payload.sub),
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/**
 * Find or create the portal user for a verified Google profile. Returns the
 * unionId to sign in as, or null if new sign-ups are closed for this email.
 */
export async function resolveGoogleUser(profile: GoogleProfile): Promise<string | null> {
  const db = getDb();
  const googleId = `google:${profile.sub}`;
  const owner = env.ownerEmails.includes(profile.email);
  const existing = await findUserByUnionId(googleId);
  if (existing) {
    await db.update(users).set({ lastSignInAt: new Date(), ...(owner && existing.role !== "admin" ? { role: "admin" as const } : {}) }).where(eq(users.id, existing.id));
    return googleId;
  }
  // Same verified email as an existing email/password account: sign into that account.
  const local = await findUserByUnionId(`local:${profile.email}`);
  if (local) {
    await db.update(users).set({ lastSignInAt: new Date(), avatar: local.avatar ?? profile.picture, ...(owner && local.role !== "admin" ? { role: "admin" as const } : {}) }).where(eq(users.id, local.id));
    return local.unionId;
  }
  if (!env.allowRegistration && !owner) return null;
  await db.insert(users).values({
    unionId: googleId,
    name: profile.name ?? profile.email.split("@")[0],
    email: profile.email,
    avatar: profile.picture,
    role: owner ? "admin" : "user",
    lastSignInAt: new Date(),
  });
  return googleId;
}

function flowCookie(c: Context, value: string, maxAge: number) {
  const secure = !/^(localhost|127\.0\.0\.1)(:|$)/.test(c.req.header("host") ?? "");
  return cookie.serialize(FLOW_COOKIE, value, { httpOnly: true, secure, sameSite: "lax", path: "/api/oauth/google", maxAge });
}

function fail(c: Context, reason: string, app = false) {
  c.header("Set-Cookie", flowCookie(c, "", 0), { append: true });
  if (app) return c.html(appReturnPage({ error: reason }));
  return c.redirect(`/login?error=${encodeURIComponent(reason)}`, 302);
}

export function registerGoogleRoutes(app: App) {
  app.get("/api/oauth/google/start", async (c) => {
    const appChallenge = c.req.query("app_challenge");
    if (appChallenge !== undefined && !isAppChallenge(appChallenge)) return c.text("Invalid app_challenge", 400);
    if (!googleSignInEnabled) return fail(c, "google_unavailable", Boolean(appChallenge));
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const intent = c.req.query("intent") === "signup" ? "signup" : "signin";
    const flow = await new jose.SignJWT({ state, verifier, intent, ...(appChallenge ? { app: appChallenge } : {}) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${FLOW_MAX_AGE}s`)
      .sign(secretKey());
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", env.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri(c));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    c.header("Set-Cookie", flowCookie(c, flow, FLOW_MAX_AGE), { append: true });
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/oauth/google/callback", async (c) => {
    if (!googleSignInEnabled) return fail(c, "google_unavailable");
    const code = c.req.query("code");
    const state = c.req.query("state");
    const raw = cookie.parse(c.req.header("cookie") ?? "")[FLOW_COOKIE];
    if (c.req.query("error")) {
      // Send a cancelled app sign-in back to the app, not the website login.
      const started = raw ? await jose.jwtVerify(raw, secretKey(), { algorithms: ["HS256"] }).catch(() => null) : null;
      return fail(c, c.req.query("error") === "access_denied" ? "google_cancelled" : "google_failed", isAppChallenge(started?.payload.app));
    }
    if (!code || !state || !raw) return fail(c, "google_expired");
    let flow: { state: string; verifier: string; app?: string };
    try {
      flow = (await jose.jwtVerify(raw, secretKey(), { algorithms: ["HS256"] })).payload as unknown as { state: string; verifier: string; app?: string };
    } catch {
      return fail(c, "google_expired");
    }
    if (flow.state !== state) return fail(c, "google_expired");
    const forApp = isAppChallenge(flow.app);

    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: redirectUri(c),
          code_verifier: flow.verifier,
        }).toString(),
      });
      if (!res.ok) {
        log.warn("google token exchange failed", { status: res.status });
        return fail(c, "google_failed", forApp);
      }
      const tokens = (await res.json()) as { id_token?: string };
      if (!tokens.id_token) return fail(c, "google_failed", forApp);
      const profile = await verifyGoogleIdToken(tokens.id_token);
      const unionId = await resolveGoogleUser(profile);
      if (!unionId) return fail(c, "invite_only", forApp);
      c.header("Set-Cookie", flowCookie(c, "", 0), { append: true });
      if (forApp) return c.html(appReturnPage({ code: await issueAppCode(unionId, flow.app!) }));
      c.header("Set-Cookie", await sessionSetCookie(c.req.raw.headers, unionId), { append: true });
      return c.redirect("/portal", 302);
    } catch (error) {
      log.warn("google sign-in failed", { error: error instanceof Error ? error.message : String(error) });
      return fail(c, "google_failed", forApp);
    }
  });
}
