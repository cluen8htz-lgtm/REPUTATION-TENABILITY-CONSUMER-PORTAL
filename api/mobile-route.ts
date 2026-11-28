/**
 * mobile-route.ts — JSON API for the Reputation Tenability scanner app.
 *
 *   POST /api/mobile/login            {identifier, password} → {token, user}
 *   POST /api/mobile/google/exchange  {code, verifier} → {token, user}
 *                                     (finishes "Continue with Google"; see auth/app-handoff.ts)
 *   GET  /api/mobile/me               → {user}
 *   GET  /api/mobile/categories       → exhibit categories for the billing-error file
 *   POST /api/mobile/fcba/exhibits    multipart: file, category, cycle?, isFirstStatement?
 *                                     → files the scan as the next exhibit (A, B, C…)
 *   GET  /api/mobile/fcba/exhibits    → the client's exhibits, newest first
 *   GET  /api/mobile/calls            → the client's collection-call log, newest first
 *   POST /api/mobile/calls            {collectorName, phoneNumber?, calledAt, direction, summary, notes?, consentAcknowledged: true}
 *   PATCH  /api/mobile/calls/:id      edit name / number / date & time / summary / notes
 *   DELETE /api/mobile/calls/:id
 *                                     Same records as the website's Call log page. Notes only, never audio.
 *
 * Auth: "Authorization: Bearer <token>". The token is the same signed session
 * token the website uses in its cookie, so every portal ownership check applies.
 */
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { callLogs, fcbaStatements, users } from "@db/schema";
import type { User } from "@db/schema";
import { EXHIBIT_CATEGORIES } from "@contracts/fcba";
import { env } from "./lib/env";
import { verifyPassword } from "./lib/password";
import { clientIp, rateLimit } from "./lib/ratelimit";
import { authenticateRequest } from "./kimi/auth";
import { signSessionToken } from "./kimi/session";
import { getDb } from "./queries/connection";
import { findUserByUnionId } from "./queries/users";
import { aiConfigured } from "./ai/llm";
import { analyzeFcbaExhibit, fileFcbaExhibit } from "./fcba-router";
import { log } from "./lib/logger";
import { redeemAppCode } from "./auth/app-handoff";

type App = Hono<{ Bindings: HttpBindings }>;
const MAX_UPLOAD = 15_000_000;
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function publicUser(user: User) {
  return { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role };
}

async function requireUser(c: Context): Promise<User | Response> {
  try {
    return await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Please sign in again." }, 401);
  }
}

const LoginBody = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(320), password: z.string().min(1).max(200) });

const CalledAt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm");
const CallFields = {
  collectorName: z.string().trim().min(2).max(255),
  phoneNumber: z.string().trim().max(40).nullish(),
  calledAt: CalledAt,
  direction: z.enum(["incoming", "outgoing"]),
  summary: z.string().trim().min(3).max(4000),
  notes: z.string().trim().max(4000).nullish(),
};
const CallCreate = z.object({ ...CallFields, consentAcknowledged: z.literal(true) });
const CallPatch = z.object(CallFields).partial().refine((v) => Object.keys(v).length > 0, "Nothing to update.");
const callError = (error: z.ZodError) => error.issues[0]?.message ?? "Check the call details.";

const ExchangeBody = z.object({ code: z.string().min(20).max(2000), verifier: z.string().min(43).max(128) });

export function registerMobileRoutes(app: App) {
  app.post("/api/mobile/login", async (c) => {
    const limit = rateLimit(`mobile-login:${clientIp(c.req.raw.headers)}`, 10, 15 * 60 * 1000);
    if (!limit.ok) return c.json({ error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` }, 429);
    const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter your username or email and password." }, 400);
    const { identifier, password } = parsed.data;
    const user = identifier.includes("@")
      ? await findUserByUnionId(`local:${identifier}`)
      : (await getDb().select().from(users).where(eq(users.username, identifier)).limit(1))[0];
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) return c.json({ error: "Username/email or password is incorrect." }, 401);
    await getDb().update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
    return c.json({ token, user: publicUser(user) });
  });

  app.post("/api/mobile/google/exchange", async (c) => {
    const limit = rateLimit(`mobile-google:${clientIp(c.req.raw.headers)}`, 20, 15 * 60 * 1000);
    if (!limit.ok) return c.json({ error: "Too many attempts. Try again shortly." }, 429);
    const parsed = ExchangeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Google sign-in didn't finish. Try again." }, 400);
    const unionId = await redeemAppCode(parsed.data.code, parsed.data.verifier);
    const user = unionId ? await findUserByUnionId(unionId) : undefined;
    if (!user) return c.json({ error: "Google sign-in expired. Try again." }, 401);
    const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
    return c.json({ token, user: publicUser(user) });
  });

  app.get("/api/mobile/me", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    return c.json({ user: publicUser(user) });
  });

  app.get("/api/mobile/categories", (c) =>
    c.json({ categories: EXHIBIT_CATEGORIES.map(({ value, label }) => ({ value, label })), ai: aiConfigured() }));

  app.get("/api/mobile/fcba/exhibits", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const rows = await getDb().select().from(fcbaStatements).where(eq(fcbaStatements.userId, user.id)).orderBy(desc(fcbaStatements.createdAt), desc(fcbaStatements.id)).limit(200);
    return c.json({
      exhibits: rows.map((r) => ({
        id: r.id,
        exhibitLabel: r.exhibitLabel,
        fileName: r.fileName,
        folder: r.folder,
        cycle: r.cycle,
        analysisStatus: r.analysisStatus,
        complianceScore: r.complianceScore,
        createdAt: r.createdAt,
      })),
    });
  });

  app.post(
    "/api/mobile/fcba/exhibits",
    bodyLimit({ maxSize: MAX_UPLOAD + 512 * 1024, onError: (c) => c.json({ error: "Files must be smaller than 15 MB." }, 413) }),
    async (c) => {
      const user = await requireUser(c);
      if (user instanceof Response) return user;
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!form || !(file instanceof File)) return c.json({ error: "Attach the scanned PDF as 'file'." }, 400);
      if (file.size === 0) return c.json({ error: "The scan is empty." }, 400);
      if (file.size > MAX_UPLOAD) return c.json({ error: "Files must be smaller than 15 MB." }, 413);
      const category = String(form.category ?? "statements");
      const cycle = typeof form.cycle === "string" ? form.cycle.slice(0, 40) : undefined;
      const isFirstStatement = form.isFirstStatement === "true";
      const name = (file.name || `Scan-${new Date().toISOString().slice(0, 10)}.pdf`).slice(0, 240);
      try {
        const filed = await fileFcbaExhibit(user.id, {
          name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type || "application/pdf",
          category,
          cycle,
          isFirstStatement,
        });
        // Read the statement in the background when AI is set up; the client sees the result in the portal.
        if (filed.analyzable && aiConfigured()) {
          analyzeFcbaExhibit(user.id, filed.id).catch((error) => log.warn("mobile analysis failed", { error: error instanceof Error ? error.message : String(error) }));
        }
        return c.json({ ...filed, analysisQueued: filed.analyzable && aiConfigured() }, 201);
      } catch (error) {
        if (error instanceof TRPCError && error.code === "BAD_REQUEST") return c.json({ error: error.message }, 400);
        log.error("mobile upload failed", { error: error instanceof Error ? error.message : String(error) });
        return c.json({ error: "Upload failed. Please try again." }, 500);
      }
    },
  );

  app.get("/api/mobile/calls", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const calls = await getDb().select().from(callLogs).where(eq(callLogs.userId, user.id)).orderBy(desc(callLogs.calledAt), desc(callLogs.id));
    return c.json({ calls });
  });

  app.post("/api/mobile/calls", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const parsed = CallCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: callError(parsed.error) }, 400);
    const [{ id }] = await getDb().insert(callLogs).values({ userId: user.id, ...parsed.data, phoneNumber: parsed.data.phoneNumber || null, notes: parsed.data.notes || null }).$returningId();
    const [call] = await getDb().select().from(callLogs).where(eq(callLogs.id, id));
    return c.json({ call }, 201);
  });

  app.patch("/api/mobile/calls/:id", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Call not found." }, 404);
    const parsed = CallPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: callError(parsed.error) }, 400);
    const own = and(eq(callLogs.id, id), eq(callLogs.userId, user.id));
    const [existing] = await getDb().select({ id: callLogs.id }).from(callLogs).where(own);
    if (!existing) return c.json({ error: "Call not found." }, 404);
    const patch = { ...parsed.data };
    if ("phoneNumber" in patch) patch.phoneNumber = patch.phoneNumber || null;
    if ("notes" in patch) patch.notes = patch.notes || null;
    await getDb().update(callLogs).set(patch).where(own);
    const [call] = await getDb().select().from(callLogs).where(own);
    return c.json({ call });
  });

  app.delete("/api/mobile/calls/:id", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const id = Number(c.req.param("id"));
    const own = and(eq(callLogs.id, id), eq(callLogs.userId, user.id));
    const [existing] = Number.isInteger(id) ? await getDb().select({ id: callLogs.id }).from(callLogs).where(own) : [];
    if (!existing) return c.json({ error: "Call not found." }, 404);
    await getDb().delete(callLogs).where(own);
    return c.json({ ok: true });
  });
}
