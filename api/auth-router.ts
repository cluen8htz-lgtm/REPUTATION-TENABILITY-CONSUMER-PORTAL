import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { users } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, adminQuery, authedQuery, publicQuery } from "./middleware";
import { env, googleSignInEnabled, kimiOAuthEnabled } from "./lib/env";
import { sessionSetCookie } from "./auth/session-cookie";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "./lib/password";
import { clientIp, rateLimit } from "./lib/ratelimit";
import { getDb } from "./queries/connection";
import { findUserByUnionId } from "./queries/users";
import { aiConfigured } from "./ai/llm";

const email = z.string().trim().toLowerCase().email().max(320);

async function issueSession(headers: Headers, resHeaders: Headers, unionId: string) {
  resHeaders.append("set-cookie", await sessionSetCookie(headers, unionId));
}

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$/;
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, "Usernames are 3–30 characters: letters, numbers, dots or underscores, starting and ending with a letter or number.");

async function findByUsername(name: string) {
  return (await getDb().select().from(users).where(eq(users.username, name)).limit(1))[0];
}

function throttle(headers: Headers, bucket: string) {
  const result = rateLimit(`${bucket}:${clientIp(headers)}`, 10, 15 * 60 * 1000);
  if (!result.ok) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many attempts. Try again in ${Math.ceil(result.retryAfterSec / 60)} minute(s).` });
  }
}

export const authRouter = createRouter({
  me: publicQuery.query((opts) => {
    const user = opts.ctx.user;
    if (!user) return null;
    const { passwordHash: _omit, ...safe } = user;
    void _omit;
    return safe;
  }),

  /** Public capability flags so the UI only offers what the server supports. */
  config: publicQuery.query(() => ({
    registration: env.allowRegistration,
    kimiOAuth: kimiOAuthEnabled,
    google: googleSignInEnabled,
    ai: aiConfigured(),
    scannerAppUrl: env.scannerAppUrl,
  })),

  register: publicQuery
    .input(z.object({ name: z.string().trim().min(2).max(120), username, email, password: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Invitation-only portals still let the configured owner emails create the first staff accounts.
      if (!env.allowRegistration && !env.ownerEmails.includes(input.email)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Accounts are by invitation only. Contact Reputation Tenability staff for access." });
      }
      throttle(ctx.req.headers, "register");
      const problem = passwordProblem(input.password);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const unionId = `local:${input.email}`;
      if (await findUserByUnionId(unionId)) {
        throw new TRPCError({ code: "CONFLICT", message: "An account with that email already exists. Sign in instead." });
      }
      if (await findByUsername(input.username)) {
        throw new TRPCError({ code: "CONFLICT", message: "That username is taken. Try another." });
      }
      const role = env.ownerEmails.includes(input.email) ? "admin" : "user";
      await getDb().insert(users).values({
        unionId,
        name: input.name,
        username: input.username,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role,
        lastSignInAt: new Date(),
      });
      await issueSession(ctx.req.headers, ctx.resHeaders, unionId);
      return { ok: true };
    }),

  login: publicQuery
    .input(z.object({ identifier: z.string().trim().toLowerCase().min(1).max(320), password: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      throttle(ctx.req.headers, "login");
      const user = input.identifier.includes("@")
        ? await findUserByUnionId(`local:${input.identifier}`)
        : await findByUsername(input.identifier);
      // Always run a hash comparison so response timing doesn't reveal accounts.
      const valid = await verifyPassword(input.password, user?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      if (!user || !valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Username/email or password is incorrect." });
      const promote = Boolean(user.email && env.ownerEmails.includes(user.email)) && user.role !== "admin";
      await getDb().update(users).set({ lastSignInAt: new Date(), ...(promote ? { role: "admin" as const } : {}) }).where(eq(users.id, user.id));
      await issueSession(ctx.req.headers, ctx.resHeaders, user.unionId);
      return { ok: true };
    }),

  usernameAvailable: publicQuery
    .input(z.object({ username: z.string().trim().toLowerCase().max(40) }))
    .query(async ({ input }) => {
      if (!USERNAME_RE.test(input.username)) return { available: false, valid: false };
      return { available: !(await findByUsername(input.username)), valid: true };
    }),

  /** Let accounts created before usernames existed (or via Google) pick one. */
  setUsername: authedQuery
    .input(z.object({ username }))
    .mutation(async ({ ctx, input }) => {
      const taken = await findByUsername(input.username);
      if (taken && taken.id !== ctx.user.id) throw new TRPCError({ code: "CONFLICT", message: "That username is taken. Try another." });
      await getDb().update(users).set({ username: input.username }).where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),

  changePassword: authedQuery
    .input(z.object({ current: z.string().max(200), next: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.passwordHash || !(await verifyPassword(input.current, ctx.user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
      }
      const problem = passwordProblem(input.next);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      await getDb().update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),

  /** Staff: create a client account (invitation-only portals). Returns a one-time temporary password. */
  inviteClient: adminQuery
    .input(z.object({ name: z.string().trim().min(2).max(120), email, role: z.enum(["user", "admin"]).default("user") }))
    .mutation(async ({ input }) => {
      const unionId = `local:${input.email}`;
      if (await findUserByUnionId(unionId)) throw new TRPCError({ code: "CONFLICT", message: "An account with that email already exists." });
      const temporaryPassword = generateTemporaryPassword();
      await getDb().insert(users).values({ unionId, name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(temporaryPassword) });
      return { email: input.email, temporaryPassword };
    }),

  /** Staff: issue a new temporary password for an existing email/password account. */
  resetClientPassword: adminQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const user = (await getDb().select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!user || !user.unionId.startsWith("local:")) throw new TRPCError({ code: "BAD_REQUEST", message: "Only email/password accounts can be reset here." });
      const temporaryPassword = generateTemporaryPassword();
      await getDb().update(users).set({ passwordHash: await hashPassword(temporaryPassword) }).where(eq(users.id, user.id));
      return { email: user.email, temporaryPassword };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
