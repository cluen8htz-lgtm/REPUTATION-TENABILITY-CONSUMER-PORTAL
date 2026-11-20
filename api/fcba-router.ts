/**
 * fcba-router.ts — FCBA Billing Error module (Cuevas file-building blueprint).
 *
 *   1. uploadStatement   — file an exhibit: instant receipt, auto label (A, B … AA),
 *                          exhibit folder, real content-type sniffing
 *   2. analyzeStatement  — Claude reads the PDF/image natively and extracts
 *                          StatementFacts (structured output); the deterministic
 *                          engine (contracts/fcba-engine.ts) decides violations;
 *                          an annotated PDF is regenerated with red marks
 *   3. saveFacts         — human-in-the-loop: client/staff corrects the facts and
 *                          the engine re-runs (works with AI fully disabled)
 *   4. createDispute / generateDisputeLetter / saveLetter — §1666 package with
 *                          30/90-day clocks; AI draft with template fallback
 *   5. addCreditorResponse — classify substantive / boilerplate / nonresponse
 *   6. /api/bundles/fcba.zip — the exhibit bundle (see files-route.ts)
 */
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { fcbaDisputes, fcbaEvents, fcbaStatements, fcbaViolations } from "@db/schema";
import { EXHIBIT_CATEGORIES } from "@contracts/fcba";
import {
  StatementFactsSchema,
  buildDisputeLetterTemplate,
  classifyResponseHeuristic,
  complianceScore,
  disputeDeadlines,
  evaluateStatement,
  exhibitLabel,
  type ResponseClass,
  type StatementFacts,
} from "@contracts/fcba-engine";
import { blob, decodeUpload, makeKey, sniffContentType } from "./lib/blob";
import { AiUnavailable, extractStructured, generateDraft } from "./ai/llm";
import { annotateStatement } from "./fcba/annotate";
import { log } from "./lib/logger";

const today = () => new Date().toISOString().slice(0, 10);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const categoryValues = EXHIBIT_CATEGORIES.map((c) => c.value) as [string, ...string[]];

const EXTRACT_SYSTEM = `You are the Reputation Tenability FCBA statement analyzer. You read one credit-card periodic statement (or credit report) and extract facts exactly as printed. Rules:
- Report only what the document shows. Use null for anything not shown; never guess.
- Dates as YYYY-MM-DD. Money as plain numbers (no $ or commas); negatives for credits shown with a minus sign.
- hasCreditLineItem is true only if a transaction line discloses the extension of credit itself (identification, amount, date).
- hasItemizedCredits is false when payments and credits appear only as one combined net figure.
- balanceComputationDisclosed is true only if the statement explains how the balance subject to interest was computed.
- tradeline is null unless the document is a credit report.
- You extract facts only; you do not give legal conclusions.`;

async function ownStatement(userId: number, id: number) {
  const stmt = await getDb().query.fcbaStatements.findFirst({ where: and(eq(fcbaStatements.id, id), eq(fcbaStatements.userId, userId)) });
  if (!stmt) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit not found." });
  return stmt;
}

async function ownDispute(userId: number, id: number) {
  const dispute = await getDb().query.fcbaDisputes.findFirst({ where: and(eq(fcbaDisputes.id, id), eq(fcbaDisputes.userId, userId)) });
  if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found." });
  return dispute;
}

/** Run the engine, persist findings, regenerate the annotated PDF. */
async function applyFacts(userId: number, stmtId: number, facts: StatementFacts, source: "ai" | "manual" | "ai_reviewed") {
  const db = getDb();
  const stmt = await ownStatement(userId, stmtId);
  const hits = evaluateStatement(facts);
  const score = complianceScore(hits);
  const bytes = await blob().get(stmt.fileKey);
  const { pdf, located } = await annotateStatement({
    bytes,
    contentType: stmt.contentType ?? "application/octet-stream",
    exhibitLabel: stmt.exhibitLabel,
    fileName: stmt.fileName,
    cycle: stmt.cycle,
    hits,
    complianceScore: score,
  });
  const annotated = await blob().put(makeKey(`fcba/${userId}/annotated`, `${stmt.exhibitLabel.replace(/\s+/g, "-")}-annotated.pdf`), pdf, "application/pdf");
  const previousAnnotated = stmt.annotatedFileKey;

  await db.delete(fcbaViolations).where(and(eq(fcbaViolations.statementId, stmt.id), eq(fcbaViolations.userId, userId)));
  if (hits.length) {
    await db.insert(fcbaViolations).values(hits.map((hit) => ({
      userId,
      statementId: stmt.id,
      ruleId: hit.ruleId,
      title: hit.title,
      statute: hit.statute,
      severity: hit.severity,
      excerpt: hit.excerpt,
      annotation: hit.annotation,
      mark: hit.mark,
      markTarget: hit.markTarget,
      page: located[hit.ruleId] ?? null,
    })));
  }
  await db.update(fcbaStatements).set({
    analysisStatus: "complete",
    analysisError: null,
    extractedFacts: JSON.stringify(facts),
    factsSource: source,
    isFirstStatement: facts.isFirstStatement,
    annotatedFileKey: annotated.key,
    complianceScore: score,
    analyzedAt: new Date(),
  }).where(eq(fcbaStatements.id, stmt.id));
  if (previousAnnotated) await blob().remove(previousAnnotated).catch(() => undefined);
  const critical = hits.filter((hit) => hit.severity === "critical").length;
  await db.insert(fcbaEvents).values({
    userId,
    statementId: stmt.id,
    type: "analyzed",
    message: `${stmt.exhibitLabel}: ${hits.length} finding(s), ${critical} critical — screening score ${score}/100 (${source === "ai" ? "AI-extracted facts" : source === "manual" ? "entered facts" : "AI facts reviewed by you"}). Annotated statement regenerated.`,
  });
  return { hits, complianceScore: score, located };
}

export const fcbaRouter = createRouter({
  uploadStatement: authedQuery
    .input(z.object({
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(21_000_000),
      contentType: z.string().max(180).optional(),
      category: z.enum(categoryValues),
      cycle: z.string().max(40).optional(),
      isFirstStatement: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      let bytes: Uint8Array;
      try {
        bytes = decodeUpload(input.contentBase64);
      } catch (error) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: (error as Error).message });
      }
      const contentType = sniffContentType(bytes, input.contentType);
      const cat = EXHIBIT_CATEGORIES.find((c) => c.value === input.category)!;
      const existing = await db.select({ id: fcbaStatements.id }).from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id));
      const label = exhibitLabel(existing.length);
      const saved = await blob().put(makeKey(`fcba/${ctx.user.id}`, input.name), bytes, contentType);
      const [{ id }] = await db.insert(fcbaStatements).values({
        userId: ctx.user.id,
        fileKey: saved.key,
        fileName: input.name,
        exhibitLabel: label,
        category: cat.value,
        folder: cat.folder,
        cycle: input.cycle || null,
        isFirstStatement: input.isFirstStatement,
        contentType,
        size: saved.size,
        analysisStatus: "pending",
      }).$returningId();
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, statementId: id, type: "uploaded", message: `${label} received and filed in "${cat.folder}".` });
      return {
        id,
        exhibitLabel: label,
        folder: cat.folder,
        analyzable: cat.value === "statements" || cat.value === "credit_reports",
        message: `Receipt confirmed. ${input.name} is filed as ${label} under ${cat.folder}.`,
      };
    }),

  /** AI extraction → deterministic engine → annotated PDF. */
  analyzeStatement: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const stmt = await ownStatement(ctx.user.id, input.id);
      await db.update(fcbaStatements).set({ analysisStatus: "analyzing", analysisError: null }).where(eq(fcbaStatements.id, stmt.id));
      try {
        const bytes = await blob().get(stmt.fileKey);
        const extracted = await extractStructured({
          schema: StatementFactsSchema,
          system: EXTRACT_SYSTEM,
          prompt: `Extract the facts from ${stmt.exhibitLabel} (${stmt.fileName}${stmt.cycle ? `, billing cycle ${stmt.cycle}` : ""}). The client ${stmt.isFirstStatement ? "states this is the FIRST periodic statement on the account; if a credit limit is shown and no origination credit is posted, set originationCreditClaimed to the credit limit" : "has not marked this as the first statement"}. Leave documentsRequested and creditorProducedDocuments false unless the document itself shows them.`,
          attachments: [{ bytes, contentType: stmt.contentType ?? "application/pdf", title: stmt.fileName }],
        });
        const facts: StatementFacts = { ...extracted, isFirstStatement: extracted.isFirstStatement || stmt.isFirstStatement };
        return { ...(await applyFacts(ctx.user.id, stmt.id, facts, "ai")), facts, source: "ai" as const };
      } catch (error) {
        const message = error instanceof AiUnavailable
          ? `${error.message} You can still enter the statement figures yourself and run the rule engine.`
          : "Analysis failed. You can enter the statement figures yourself and run the rule engine.";
        if (!(error instanceof AiUnavailable)) log.error("fcba analysis failed", { error: error instanceof Error ? error.message : String(error) });
        await db.update(fcbaStatements).set({ analysisStatus: "failed", analysisError: message.slice(0, 500) }).where(eq(fcbaStatements.id, stmt.id));
        return { hits: [], complianceScore: null, located: {}, facts: null, source: null, error: message };
      }
    }),

  /** Human-in-the-loop: accept edited facts and re-run the engine (no AI needed). */
  saveFacts: authedQuery
    .input(z.object({ id: z.number().int().positive(), facts: StatementFactsSchema }))
    .mutation(async ({ ctx, input }) => {
      const stmt = await ownStatement(ctx.user.id, input.id);
      const source = stmt.factsSource === "ai" || stmt.factsSource === "ai_reviewed" ? "ai_reviewed" : "manual";
      return applyFacts(ctx.user.id, stmt.id, input.facts, source);
    }),

  /** Live preview for the facts editor — evaluates without persisting. */
  previewRules: authedQuery
    .input(z.object({ facts: StatementFactsSchema }))
    .query(({ input }) => {
      const hits = evaluateStatement(input.facts);
      return { hits, complianceScore: complianceScore(hits) };
    }),

  statement: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const stmt = await ownStatement(ctx.user.id, input.id);
      const violations = await getDb().select().from(fcbaViolations).where(and(eq(fcbaViolations.statementId, stmt.id), eq(fcbaViolations.userId, ctx.user.id)));
      return { ...stmt, facts: stmt.extractedFacts ? (JSON.parse(stmt.extractedFacts) as StatementFacts) : null, violations };
    }),

  listStatements: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id)).orderBy(asc(fcbaStatements.createdAt))),

  listViolations: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id)).orderBy(desc(fcbaViolations.createdAt))),

  removeStatement: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const stmt = await ownStatement(ctx.user.id, input.id);
      await db.delete(fcbaViolations).where(eq(fcbaViolations.statementId, stmt.id));
      await db.delete(fcbaStatements).where(eq(fcbaStatements.id, stmt.id));
      await Promise.all([stmt.fileKey, stmt.annotatedFileKey].filter(Boolean).map((key) => blob().remove(key!).catch(() => undefined)));
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, type: "removed", message: `${stmt.exhibitLabel} (${stmt.fileName}) removed. Existing labels are kept so exhibit references stay stable.` });
      return { ok: true };
    }),

  createDispute: authedQuery
    .input(z.object({
      creditorName: z.string().trim().min(2).max(255),
      accountLast4: z.string().trim().regex(/^\d{4}$/, "Enter the last four digits of the account."),
      noticeType: z.enum(["billing_error", "noncompliance_notice", "arbitration_demand"]),
      creditorReceivedDate: isoDay.optional(),
      sentVia: z.string().max(60).optional(),
      trackingNumbers: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const violations = await db.select().from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id));
      const statements = await db.select({ id: fcbaStatements.id }).from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id));
      const kind = { billing_error: "Billing-error notice", noncompliance_notice: "Notice of FCBA non-compliance", arbitration_demand: "Pre-arbitration demand" }[input.noticeType];
      const distinct = new Set(violations.map((v) => v.ruleId));
      const summary = `${kind} to ${input.creditorName}, account ending ${input.accountLast4}: ${violations.length} finding(s) (${distinct.size} distinct rule(s)) across ${statements.length} exhibit(s).`;
      const deadlines = input.creditorReceivedDate ? disputeDeadlines(input.creditorReceivedDate) : null;
      const [{ id }] = await db.insert(fcbaDisputes).values({
        userId: ctx.user.id,
        creditorName: input.creditorName,
        accountLast4: input.accountLast4,
        noticeType: input.noticeType,
        summary,
        status: input.noticeType === "arbitration_demand" ? "arbitration" : "open",
        creditorReceivedDate: input.creditorReceivedDate ?? null,
        sentVia: input.sentVia || null,
        trackingNumbers: input.trackingNumbers || null,
        ackDeadline: deadlines?.acknowledgeBy ?? null,
        resolveDeadline: deadlines?.resolveBy ?? null,
      }).$returningId();
      await db.insert(fcbaEvents).values({
        userId: ctx.user.id,
        disputeId: id,
        type: "dispute_opened",
        message: deadlines
          ? `${kind} opened. Acknowledgment due ${deadlines.acknowledgeBy}; resolution due ${deadlines.resolveBy}.`
          : `${kind} opened. Add the date the creditor received it to start the 30/90-day clocks.`,
      });
      return { id, summary };
    }),

  updateDispute: authedQuery
    .input(z.object({
      id: z.number().int().positive(),
      creditorReceivedDate: isoDay.nullable().optional(),
      sentVia: z.string().max(60).nullable().optional(),
      trackingNumbers: z.string().max(300).nullable().optional(),
      status: z.enum(["open", "acknowledged", "escalated", "resolved", "arbitration"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dispute = await ownDispute(ctx.user.id, input.id);
      const patch: Partial<typeof fcbaDisputes.$inferInsert> = {};
      if (input.creditorReceivedDate !== undefined) {
        patch.creditorReceivedDate = input.creditorReceivedDate;
        const deadlines = input.creditorReceivedDate ? disputeDeadlines(input.creditorReceivedDate) : null;
        patch.ackDeadline = deadlines?.acknowledgeBy ?? null;
        patch.resolveDeadline = deadlines?.resolveBy ?? null;
      }
      if (input.sentVia !== undefined) patch.sentVia = input.sentVia;
      if (input.trackingNumbers !== undefined) patch.trackingNumbers = input.trackingNumbers;
      if (input.status) patch.status = input.status;
      await getDb().update(fcbaDisputes).set(patch).where(eq(fcbaDisputes.id, dispute.id));
      if (input.status && input.status !== dispute.status) {
        await getDb().insert(fcbaEvents).values({ userId: ctx.user.id, disputeId: dispute.id, type: "status", message: `Dispute status changed from ${dispute.status} to ${input.status}.` });
      }
      return { ok: true };
    }),

  /** Draft (or redraft) the letter. AI when available; deterministic template otherwise. */
  generateDisputeLetter: authedQuery
    .input(z.object({ disputeId: z.number().int().positive(), useAi: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dispute = await ownDispute(ctx.user.id, input.disputeId);
      const stmts = await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id)).orderBy(asc(fcbaStatements.createdAt));
      const violations = stmts.length
        ? await db.select().from(fcbaViolations).where(and(eq(fcbaViolations.userId, ctx.user.id), inArray(fcbaViolations.statementId, stmts.map((s) => s.id))))
        : [];
      const labelOf = new Map(stmts.map((s) => [s.id, s.exhibitLabel]));
      const letterInput = {
        noticeType: dispute.noticeType,
        consumerName: ctx.user.name || "Cardholder",
        creditorName: dispute.creditorName,
        accountLast4: dispute.accountLast4,
        todayIso: today(),
        exhibits: stmts.map((s) => ({ label: s.exhibitLabel, fileName: s.fileName, cycle: s.cycle })),
        violations: violations.map((v) => ({ ruleId: v.ruleId, title: v.title, statute: v.statute, excerpt: v.excerpt, exhibit: labelOf.get(v.statementId) ?? null })),
        creditorReceivedIso: dispute.creditorReceivedDate,
      };
      const template = buildDisputeLetterTemplate(letterInput);
      let letter = template;
      let source: "ai" | "template" = "template";
      let notice: string | undefined;
      if (input.useAi) {
        try {
          letter = await generateDraft({
            system: `You are the Reputation Tenability FCBA drafting assistant. You prepare attorney-review drafts of consumer billing-error correspondence under 15 U.S.C. §§1637(b), 1666, 1666a, 1666b, 1666d and 12 C.F.R. Part 1026. Hard rules: use ONLY the facts, exhibits, and findings supplied; never invent dates, amounts, account details, or case citations; keep every statute citation exactly as given; write in plain, firm, professional English; output the letter text only (no commentary, no markdown).`,
            prompt: `Improve this ${dispute.noticeType.replaceAll("_", " ")} draft for clarity and persuasiveness while keeping its structure (header, itemized errors with authority, documentary-evidence demand, relief, deadlines, exhibits, preservation request, signature, and the closing attorney-review line). Do not add findings that are not listed.\n\n---\n${template}`,
            effort: "medium",
          });
          source = "ai";
        } catch (error) {
          notice = error instanceof AiUnavailable ? `${error.message} A template draft was generated instead.` : "AI drafting failed; a template draft was generated instead.";
        }
      }
      await db.update(fcbaDisputes).set({ letterDraft: letter, letterSource: source }).where(eq(fcbaDisputes.id, dispute.id));
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, disputeId: dispute.id, type: "draft", message: `Letter drafted (${source === "ai" ? "AI-assisted" : "template"}) for attorney review.` });
      return { letter, source, notice };
    }),

  saveLetter: authedQuery
    .input(z.object({ disputeId: z.number().int().positive(), letter: z.string().min(20).max(60_000) }))
    .mutation(async ({ ctx, input }) => {
      const dispute = await ownDispute(ctx.user.id, input.disputeId);
      await getDb().update(fcbaDisputes).set({ letterDraft: input.letter, letterSource: "edited" }).where(eq(fcbaDisputes.id, dispute.id));
      return { ok: true };
    }),

  /** Creditor reply → classification → auto-escalation. */
  addCreditorResponse: authedQuery
    .input(z.object({
      disputeId: z.number().int().positive(),
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(21_000_000),
      contentType: z.string().max(180).optional(),
      receivedDate: isoDay,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dispute = await ownDispute(ctx.user.id, input.disputeId);
      const bytes = decodeUpload(input.contentBase64);
      const contentType = sniffContentType(bytes, input.contentType);
      const cat = EXHIBIT_CATEGORIES.find((c) => c.value === "responses")!;
      const count = (await db.select({ id: fcbaStatements.id }).from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id))).length;
      const label = exhibitLabel(count);
      const saved = await blob().put(makeKey(`fcba/${ctx.user.id}/responses`, input.name), bytes, contentType);
      await db.insert(fcbaStatements).values({
        userId: ctx.user.id, fileKey: saved.key, fileName: input.name, exhibitLabel: label, category: cat.value, folder: cat.folder,
        cycle: `received ${input.receivedDate}`, contentType, size: saved.size, analysisStatus: "complete",
      });

      let classification: ResponseClass;
      let reasoning: string;
      const heuristic = contentType.startsWith("text/") ? classifyResponseHeuristic(Buffer.from(bytes).toString("utf8")) : null;
      try {
        const result = await extractStructured({
          schema: z.object({
            classification: z.enum(["substantive", "boilerplate", "nonresponse"]),
            reasoning: z.string().describe("One or two sentences citing what the letter does or does not address"),
          }),
          system: "You classify a creditor's reply to a consumer billing-error notice. substantive = it addresses the specific errors asserted (corrects them, or explains in writing why the account is correct with supporting documentation). boilerplate = it encloses statement copies, requests forms, or states a conclusion without addressing the specific errors. nonresponse = it does not respond to the dispute at all.",
          prompt: `Billing-error notice asserted: ${dispute.summary}\nClassify the attached creditor correspondence received ${input.receivedDate}.`,
          attachments: [{ bytes, contentType, title: input.name }],
          effort: "low",
        });
        classification = result.classification;
        reasoning = result.reasoning;
      } catch {
        if (!heuristic) {
          classification = "substantive";
          reasoning = "Automatic classification unavailable for this file type — flagged for staff review.";
        } else {
          classification = heuristic.classification;
          reasoning = `Heuristic signals: ${heuristic.signals.join(", ") || "none"}.`;
        }
      }
      const escalate = classification !== "substantive";
      const ackBy = dispute.ackDeadline;
      const late = ackBy ? input.receivedDate > ackBy : false;
      await db.update(fcbaDisputes).set({
        lastResponseClass: classification,
        status: escalate ? "escalated" : dispute.status === "open" ? "acknowledged" : dispute.status,
      }).where(eq(fcbaDisputes.id, dispute.id));
      await db.insert(fcbaEvents).values({
        userId: ctx.user.id,
        disputeId: dispute.id,
        type: "creditor_response",
        message: `${label}: creditor response classified ${classification.toUpperCase()}. ${reasoning}${late ? ` Received after the ${ackBy} acknowledgment deadline.` : ""}${escalate ? " Escalation recommended: open a Notice of FCBA Non-Compliance." : ""}`,
      });
      return { classification, reasoning, escalated: escalate, late, exhibitLabel: label };
    }),

  listDisputes: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, ctx.user.id)).orderBy(desc(fcbaDisputes.createdAt))),

  timeline: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaEvents).where(eq(fcbaEvents.userId, ctx.user.id)).orderBy(desc(fcbaEvents.createdAt)).limit(100)),

  disputeTimeline: authedQuery
    .input(z.object({ disputeId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getDb().select().from(fcbaEvents)
        .where(and(eq(fcbaEvents.userId, ctx.user.id), eq(fcbaEvents.disputeId, input.disputeId)))
        .orderBy(desc(fcbaEvents.createdAt))),
});
