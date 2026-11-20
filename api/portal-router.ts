import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  callLogs,
  clientProfiles,
  courtCases,
  documents,
  fcbaDisputes,
  fcbaStatements,
  fcbaViolations,
  repoCases,
  users,
  videoLessons,
} from "@db/schema";
import { DOCUMENT_CATEGORIES, SERVICE_AREAS } from "@contracts/portal";
import { blob, decodeUpload, makeKey, sniffContentType } from "./lib/blob";
import { AiUnavailable, generateDraft } from "./ai/llm";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional();
const countySchema = z.string().min(2).max(80);

function assertServiceArea(state: string, county: string) {
  const area = SERVICE_AREAS.find((item) => item.state === state);
  if (!area || !area.counties.includes(county as never)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select a supported state and county." });
  }
}

export const portalRouter = createRouter({
  dashboard: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [profile, cases, docs, calls, disputes, statements, findings, repo] = await Promise.all([
      db.query.clientProfiles.findFirst({ where: eq(clientProfiles.userId, ctx.user.id) }),
      db.select().from(courtCases).where(eq(courtCases.userId, ctx.user.id)).orderBy(desc(courtCases.createdAt)),
      db.select().from(documents).where(eq(documents.userId, ctx.user.id)).orderBy(desc(documents.createdAt)),
      db.select().from(callLogs).where(eq(callLogs.userId, ctx.user.id)).orderBy(desc(callLogs.calledAt)),
      db.select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, ctx.user.id)),
      db.select({ id: fcbaStatements.id, score: fcbaStatements.complianceScore }).from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id)),
      db.select({ severity: fcbaViolations.severity }).from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id)),
      db.select().from(repoCases).where(eq(repoCases.userId, ctx.user.id)),
    ]);
    const deadlines = [
      ...cases.filter((c) => c.status !== "closed" && c.nextDeadline).map((c) => ({ date: c.nextDeadline!, label: c.deadlineLabel || "Entered case date", context: c.title, href: "/portal/cases", verified: false })),
      ...disputes.filter((d) => d.status !== "resolved").flatMap((d) => [
        d.ackDeadline && d.status === "open" ? { date: d.ackDeadline, label: "FCBA acknowledgment due (30 days)", context: `${d.creditorName} ····${d.accountLast4}`, href: "/portal/billing-error", verified: true } : null,
        d.resolveDeadline ? { date: d.resolveDeadline, label: "FCBA resolution due (≤90 days)", context: `${d.creditorName} ····${d.accountLast4}`, href: "/portal/billing-error", verified: true } : null,
      ]).filter((x): x is NonNullable<typeof x> => Boolean(x)),
      ...repo.filter((k) => k.saleDate && k.status !== "resolved").map((k) => ({ date: k.saleDate!, label: "Scheduled disposition — redemption ends", context: k.vehicle, href: "/portal/repossession", verified: false })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return {
      profile,
      cases,
      documents: docs,
      calls,
      deadlines,
      fcba: { exhibits: statements.length, findings: findings.length, critical: findings.filter((f) => f.severity === "critical").length, disputes: disputes.length },
      repo: { cases: repo.length, maxRisk: repo.reduce((m, k) => Math.max(m, k.riskScore ?? 0), 0) },
    };
  }),

  saveIntake: authedQuery
    .input(z.object({
      phone: z.string().max(40).optional(),
      state: z.enum(["FL", "CA"]),
      county: countySchema,
      serviceInterest: z.string().min(2).max(80),
      contactPreference: z.enum(["Email", "Phone", "Text", "Secure message"]),
      intakeNotes: z.string().max(5000).optional(),
      intakeCompleted: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertServiceArea(input.state, input.county);
      await getDb().insert(clientProfiles).values({ userId: ctx.user.id, ...input }).onDuplicateKeyUpdate({
        set: { ...input, updatedAt: new Date() },
      });
      return { ok: true };
    }),

  listCases: authedQuery.query(({ ctx }) =>
    getDb().select().from(courtCases).where(eq(courtCases.userId, ctx.user.id)).orderBy(desc(courtCases.createdAt))),

  createCase: authedQuery
    .input(z.object({
      title: z.string().min(3).max(255),
      plaintiff: z.string().min(2).max(255),
      defendant: z.string().min(2).max(255),
      court: z.string().max(255).optional(),
      state: z.enum(["FL", "CA"]),
      county: countySchema,
      caseNumber: z.string().max(120).optional(),
      caseType: z.string().max(80).default("Debt collection"),
      filedOn: dateInput,
      servedOn: dateInput,
      nextDeadline: dateInput,
      deadlineLabel: z.string().max(120).optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertServiceArea(input.state, input.county);
      const [{ id }] = await getDb().insert(courtCases).values({ userId: ctx.user.id, ...input }).$returningId();
      return { id };
    }),

  updateCaseStatus: authedQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["needs_review", "active", "closed"]) }))
    .mutation(async ({ ctx, input }) => {
      await getDb().update(courtCases).set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(courtCases.id, input.id), eq(courtCases.userId, ctx.user.id)));
      return { ok: true };
    }),

  listDocuments: authedQuery.query(({ ctx }) =>
    getDb().select().from(documents).where(eq(documents.userId, ctx.user.id)).orderBy(desc(documents.createdAt))),

  uploadDocument: authedQuery
    .input(z.object({
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(21_000_000),
      contentType: z.string().max(180).optional(),
      category: z.string().min(2).max(80),
      caseId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let bytes: Uint8Array;
      try {
        bytes = decodeUpload(input.contentBase64);
      } catch (error) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: (error as Error).message });
      }
      const category = DOCUMENT_CATEGORIES.find((item) => item.value === input.category) ?? DOCUMENT_CATEGORIES.at(-1)!;
      if (input.caseId) {
        const ownedCase = await getDb().query.courtCases.findFirst({
          where: and(eq(courtCases.id, input.caseId), eq(courtCases.userId, ctx.user.id)),
        });
        if (!ownedCase) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected case was not found." });
      }
      const contentType = sniffContentType(bytes, input.contentType);
      const saved = await blob().put(makeKey(`u/${ctx.user.id}`, input.name), bytes, contentType);
      const [{ id }] = await getDb().insert(documents).values({
        userId: ctx.user.id,
        caseId: input.caseId,
        fileKey: saved.key,
        fileName: input.name,
        contentType,
        size: saved.size,
        category: category.value,
        folder: category.folder,
      }).$returningId();
      return { id, key: saved.key };
    }),

  documentUrl: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const doc = await getDb().query.documents.findFirst({
        where: and(eq(documents.id, input.id), eq(documents.userId, ctx.user.id)),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      return { url: `/api/files/document/${doc.id}` };
    }),

  removeDocument: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await getDb().query.documents.findFirst({
        where: and(eq(documents.id, input.id), eq(documents.userId, ctx.user.id)),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await getDb().delete(documents).where(eq(documents.id, doc.id));
      await blob().remove(doc.fileKey).catch(() => undefined);
      return { ok: true };
    }),

  listCalls: authedQuery.query(({ ctx }) =>
    getDb().select().from(callLogs).where(eq(callLogs.userId, ctx.user.id)).orderBy(desc(callLogs.calledAt))),

  createCall: authedQuery
    .input(z.object({
      caseId: z.number().int().positive().optional(),
      collectorName: z.string().min(2).max(255),
      phoneNumber: z.string().max(40).optional(),
      calledAt: z.string().min(4).max(25),
      direction: z.enum(["incoming", "outgoing"]),
      summary: z.string().min(3).max(4000),
      notes: z.string().max(4000).optional(),
      consentAcknowledged: z.literal(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.caseId) {
        const ownedCase = await getDb().query.courtCases.findFirst({
          where: and(eq(courtCases.id, input.caseId), eq(courtCases.userId, ctx.user.id)),
        });
        if (!ownedCase) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected case was not found." });
      }
      const [{ id }] = await getDb().insert(callLogs).values({ userId: ctx.user.id, ...input }).$returningId();
      return { id };
    }),

  listVideos: authedQuery.query(() =>
    getDb().select().from(videoLessons).where(eq(videoLessons.published, true)).orderBy(desc(videoLessons.createdAt))),

  askAssistant: authedQuery
    .input(z.object({ question: z.string().min(5).max(2000) }))
    .mutation(async ({ input }) => {
      try {
        const answer = await generateDraft({
          system: `You are the Reputation Tenability consumer-education assistant. Provide cautious general education about debt-collection lawsuits, credit reports, billing errors, and repossession. Never provide definitive legal advice, calculate a court deadline, promise deletion of accurate information, guarantee an outcome, or invent a citation. Distinguish allegations from proven facts. Encourage review by a licensed attorney or qualified legal aid for court action. Keep answers under 250 words and list practical record-organization steps when useful.`,
          prompt: input.question,
          effort: "low",
          maxTokens: 2000,
        });
        return { answer, unavailable: "" };
      } catch (error) {
        return {
          answer: "",
          unavailable: error instanceof AiUnavailable && error.reason === "transient"
            ? "The education assistant is temporarily unavailable. Please try again in a few minutes."
            : "The education assistant is not available right now. Your saved cases and documents remain available; contact staff for help.",
        };
      }
    }),

  adminOverview: adminQuery.query(async () => {
    const db = getDb();
    const [clients, cases, docs, videos] = await Promise.all([
      db.select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt, lastSignInAt: users.lastSignInAt }).from(users).orderBy(desc(users.createdAt)),
      db.select().from(courtCases).orderBy(desc(courtCases.createdAt)),
      db.select().from(documents).orderBy(desc(documents.createdAt)),
      db.select().from(videoLessons).orderBy(desc(videoLessons.createdAt)),
    ]);
    return { clients, cases, documents: docs, videos };
  }),

  adminDocumentUrl: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const doc = await getDb().query.documents.findFirst({ where: eq(documents.id, input.id) });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      return { url: `/api/files/document/${doc.id}` };
    }),

  adminReviewDocument: adminQuery
    .input(z.object({ id: z.number().int().positive(), staffSummary: z.string().min(3).max(5000) }))
    .mutation(async ({ input }) => {
      await getDb().update(documents).set({ reviewStatus: "reviewed", staffSummary: input.staffSummary })
        .where(eq(documents.id, input.id));
      return { ok: true };
    }),

  adminAddVideo: adminQuery
    .input(z.object({
      title: z.string().min(3).max(255),
      description: z.string().min(10).max(4000),
      videoUrl: z.string().url().max(1000).refine((value) => {
        try {
          return ["https:", "http:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Use an http or https video link."),
      category: z.string().min(2).max(80),
      duration: z.string().max(30).optional(),
    }))
    .mutation(async ({ input }) => {
      const [{ id }] = await getDb().insert(videoLessons).values(input).$returningId();
      return { id };
    }),
});
