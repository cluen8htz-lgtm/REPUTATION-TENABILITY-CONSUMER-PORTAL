/**
 * app-handoff.ts — hands a finished website Google sign-in to the RT Scanner
 * app without ever putting a session token in a URL.
 *
 * 1. The app makes a random verifier and opens
 *    /api/oauth/google/start?app_challenge=<base64url(sha256(verifier))>
 *    in a browser tab (Custom Tab).
 * 2. After Google, the callback issues a one-time code bound to that challenge
 *    (signed, 2-minute expiry) and sends the browser to rtscanner://auth?code=…
 * 3. The app posts {code, verifier} to /api/mobile/google/exchange. Only the app
 *    that knows the verifier can redeem the code, and each code works once.
 */
import * as jose from "jose";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../lib/env";

export const APP_SCHEME_URL = "rtscanner://auth";
const CODE_TTL_SEC = 120;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const used = new Map<string, number>(); // jti → expiry (ms); single-instance replay guard

const key = () => new TextEncoder().encode(env.appSecret);

export const isAppChallenge = (value: unknown): value is string => typeof value === "string" && CHALLENGE.test(value);

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function issueAppCode(unionId: string, challenge: string): Promise<string> {
  return new jose.SignJWT({ uid: unionId, chl: challenge })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("rt-scanner-handoff")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${CODE_TTL_SEC}s`)
    .sign(key());
}

/** Returns the unionId for a valid, unused code whose challenge matches the verifier, else null. */
export async function redeemAppCode(code: string, verifier: string): Promise<string | null> {
  if (verifier.length < 43 || verifier.length > 128) return null;
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(code, key(), { algorithms: ["HS256"], audience: "rt-scanner-handoff" }));
  } catch {
    return null;
  }
  if (typeof payload.uid !== "string" || typeof payload.chl !== "string" || !payload.jti) return null;
  if (challengeFor(verifier) !== payload.chl) return null;
  const now = Date.now();
  for (const [jti, exp] of used) if (exp < now) used.delete(jti);
  if (used.has(payload.jti)) return null;
  used.set(payload.jti, (payload.exp ?? 0) * 1000);
  return payload.uid;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Tiny page that bounces the browser tab back into the app (with a manual button as fallback). */
export function appReturnPage(params: Record<string, string>): string {
  const target = `${APP_SCHEME_URL}?${new URLSearchParams(params).toString()}`;
  const ok = "code" in params;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${escape(target)}"><title>Return to RT Scanner</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0b;color:#f2ede3;font:16px Arial,sans-serif;text-align:center}
main{padding:24px;max-width:360px}h1{font-size:20px;margin:0 0 8px}p{color:#bdb5a6;font-size:14px;line-height:1.5}
a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:10px;background:#d9b56a;color:#111;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>${ok ? "Signed in with Google" : "Sign-in didn’t finish"}</h1><p>${ok ? "Returning you to the RT Scanner app…" : "Go back to the app and try again."}</p>
<a href="${escape(target)}">Return to RT Scanner</a></main></body></html>`;
}
