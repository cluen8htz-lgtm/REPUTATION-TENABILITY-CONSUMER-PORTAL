/**
 * mobile-route.ts — JSON API for the Reputation Tenability scanner app.
 *
 *   POST /api/mobile/login            {identifier, password} → {token, user}
 *   GET  /api/mobile/me               → {user}
 *   GET  /api/mobile/categories       → exhibit categories for the billing-error file
 *   POST /api/mobile/fcba/exhibits    multipart: file, category, cycle?, isFirstStatement?
 *                                     → files the scan as the next exhibit (A, B, C…)
 *   GET  /api/mobile/fcba/exhibits    → the client's exhibits, newest first
 *
 * Auth: "Authorization: Bearer <token>". The token is the same signed session
 * token the website uses in its cookie, so every portal ownership check applies.
 */
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { fcbaStatements, users } from "@db/schema";
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
}
