/**
 * fcba-router.ts — FCBA Billing Error module tRPC router.
 *
 * Flow (mirrors the Cuevas file-building blueprint):
 *   1. uploadStatement    — client uploads a periodic statement (or any artifact)
 *   2. (auto) acknowledge — portal immediately confirms receipt + assigns exhibit
 *                           label + categorizes into a folder
 *   3. analyzeStatement   — AI extraction + FCBA_RULES engine; regenerates an
 *                           annotated PDF (red triangles around credit limit,
 *                           brackets under transactions, callout notes)
 *   4. addCreditorResponse— creditor letter comes in -> auto-escalation check
 *   5. generateDispute    — drafts the §1666 billing-error notice / non-compliance
 *                           notice / arbitration demand from detected violations
 *   6. downloadBundle     — zip of all exhibits in order, labeled, for the
 *                           attorney/arbitration file
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  fcbaStatements,
  fcbaViolations,
  fcbaDisputes,
  fcbaEvents,
  documents,
} from "@db/schema";
import { FCBA_RULES, FCBA_DEADLINES, EXHIBIT_CATEGORIES } from "@contracts/fcba";
import { storage } from "./lib/storage";
import { listModels, classifyAiError } from "./ai/ai-client";
import { kimiGw } from "./ai/provider";
import { generateText } from "ai";

const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

async function nextExhibitLabel(userId: number): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, userId));
  return `Exhibit ${LETTERS[rows.length % 26]}${rows.length >= 26 ? Math.floor(rows.length / 26) : ""}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Rule evaluation over AI-extracted statement fields. */
function evaluateRules(extracted: {
  isFirstStatement: boolean;
  creditLimit: number | null;
  creditsTotal: number;
  originationCreditClaimed: number | null;
  hasCreditLineItem: boolean;
  beginningBalance: number | null;
  endingBalance: number | null;
  hasCreditDebitDesignation: boolean;
  hasUnitemizedCreditsNet: boolean;
  balanceComputationDisclosed: boolean;
  statementDate: string | null;
  dueDate: string | null;
  priorStatementCompliant: boolean | null;
  ytdInterest: number | null;
  disclosedBalanceForInterest: number | null;
  apr: number | null;
  creditBalanceAsserted: number | null;
  creditBalanceRefunded: boolean;
  creditorProducedDocuments: boolean;
}) {
  const hits: Array<{ ruleId: string; severity: "critical" | "major" | "minor"; excerpt: string }> = [];
  const push = (id: string, sev: "critical" | "major" | "minor", ex: string) => hits.push({ ruleId: id, severity: sev, excerpt: ex });

  if (extracted.isFirstStatement && extracted.creditLimit && !extracted.hasCreditLineItem)
    push("FCBA-001", "critical", `Credit limit $${extracted.creditLimit} shown with no disclosed origination credit transaction.`);
  if (extracted.isFirstStatement && extracted.originationCreditClaimed && extracted.creditsTotal === 0)
    push("FCBA-002", "critical", `Statement reports Credits: $0.00 despite asserted $${extracted.originationCreditClaimed} origination credit.`);
  if (!extracted.balanceComputationDisclosed && extracted.creditsTotal === 0 && extracted.originationCreditClaimed)
    push("FCBA-003", "critical", "No disclosure that balance was computed without deducting credits, and no amount of such credits disclosed.");
  if (!extracted.priorStatementCompliant && extracted.beginningBalance !== null)
    push("FCBA-004", "major", `Beginning balance $${extracted.beginningBalance} carried forward from non-compliant prior statement; no credit/debit designation.`);
  push("FCBA-005", "critical", hits.length > 0 ? "Statement fails §1637(b) mandatory disclosures — treated as no statement." : "Statement contains all mandatory §1637(b) disclosures.");
  if (extracted.hasUnitemizedCreditsNet)
    push("FCBA-006", "major", "'Payments, Credits' reported as a single unitemized net.");
  if (extracted.statementDate && extracted.dueDate) {
    const days = (new Date(extracted.dueDate).getTime() - new Date(extracted.statementDate).getTime()) / 86400000;
    if (days < 21) push("FCBA-007", "major", `Only ${Math.round(days)} days between statement date and due date (< 21 required by §1666b).`);
  }
  if (extracted.priorStatementCompliant === false)
    push("FCBA-008", "major", "Each successive statement carrying forward the defective balance is an independent violation (Krieger).");
  if (extracted.creditBalanceAsserted && extracted.creditBalanceAsserted > 1 && !extracted.creditBalanceRefunded)
    push("FCBA-009", "critical", `Credit balance $${extracted.creditBalanceAsserted} asserted and not applied or refunded (§1666d).`);
  if (extracted.ytdInterest !== null && extracted.disclosedBalanceForInterest !== null && extracted.apr) {
    const maxLawful = extracted.disclosedBalanceForInterest * (extracted.apr / 100);
    if (extracted.ytdInterest > maxLawful * 2)
      push("FCBA-012", "critical", `YTD interest $${extracted.ytdInterest} is arithmetically impossible on disclosed balance $${extracted.disclosedBalanceForInterest} at ${extracted.apr}% (max ≈$${maxLawful.toFixed(2)}).`);
  }
  if (!extracted.creditorProducedDocuments)
    push("FCBA-013", "major", "Signed credit document / documentary evidence requested and not produced (§1026.13(a)(6),(f)(2); Widjaja).");
  return hits.filter(h => !h.ruleId.startsWith("FCBA-005") || h.severity === "critical");
}

export const fcbaRouter = createRouter({
  /** Upload a periodic statement or any artifact -> auto-ack + exhibit label + folder. */
  uploadStatement: authedQuery
    .input(z.object({
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(8_500_000),
      contentType: z.string().max(180).optional(),
      category: z.enum(EXHIBIT_CATEGORIES.map(c => c.value) as [string, ...string[]]),
      cycle: z.string().max(40).optional(),
      isFirstStatement: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > 6_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Files must be under 6 MB." });
      const cat = EXHIBIT_CATEGORIES.find(c => c.value === input.category)!;
      const safeName = input.name.replace(/[^\p{L}\p{N}._ -]/gu, "_");
      const saved = await storage.uploadFile({ fileContent: bytes, fileName: `fcba/${ctx.user.id}/${Date.now()}-${safeName}`, contentType: input.contentType });
      const exhibitLabel = await nextExhibitLabel(ctx.user.id);
      const [{ id }] = await db.insert(fcbaStatements).values({
        userId: ctx.user.id,
        fileKey: saved.key,
        fileName: input.name,
        exhibitLabel,
        category: cat.value,
        folder: cat.folder,
        cycle: input.cycle ?? null,
        isFirstStatement: input.isFirstStatement,
        analysisStatus: "pending",
      }).$returningId();
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, statementId: id, type: "uploaded", message: `${exhibitLabel} received and filed in "${cat.folder}". Analysis queued.` });
      return { id, exhibitLabel, folder: cat.folder, message: `Receipt confirmed. ${exhibitLabel} filed under ${cat.folder}. Our system has begun FCBA/TILA analysis and will notify you when the violation map is ready.` };
    }),

  /** AI extraction + rule engine + annotated regeneration. */
  analyzeStatement: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const stmt = await db.query.fcbaStatements.findFirst({ where: and(eq(fcbaStatements.id, input.id), eq(fcbaStatements.userId, ctx.user.id)) });
      if (!stmt) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(fcbaStatements).set({ analysisStatus: "analyzing" }).where(eq(fcbaStatements.id, stmt.id));

      const bytes = await storage.readFile({ fileKey: stmt.fileKey });
      let extracted: Parameters<typeof evaluateRules>[0];
      try {
        const { defaultModelId } = await listModels();
        const res = await generateText({
          model: kimiGw(defaultModelId),
          system: `You are the Reputation Tenability FCBA statement analyzer. Extract structured data from this periodic statement. Respond ONLY with JSON: {"isFirstStatement":bool,"creditLimit":number|null,"creditsTotal":number,"originationCreditClaimed":number|null,"hasCreditLineItem":bool,"beginningBalance":number|null,"endingBalance":number|null,"hasCreditDebitDesignation":bool,"hasUnitemizedCreditsNet":bool,"balanceComputationDisclosed":bool,"statementDate":"YYYY-MM-DD"|null,"dueDate":"YYYY-MM-DD"|null,"priorStatementCompliant":bool|null,"ytdInterest":number|null,"disclosedBalanceForInterest":number|null,"apr":number|null,"creditBalanceAsserted":number|null,"creditBalanceRefunded":bool,"creditorProducedDocuments":bool}. If origination credit exists per account context, originationCreditClaimed = creditLimit. Never provide legal advice; extract facts only.`,
          prompt: `Account context: origination credit extension = credit limit amount if this is the first statement. Statement text:\n${bytes.slice(0, 120000).toString()}`,
          providerOptions: { "kimi-gw": { max_completion_tokens: 1200 } },
        });
        extracted = JSON.parse(res.text.replace(/```json|```/g, "").trim());
      } catch (e) {
        const mapped = classifyAiError(e);
        await db.update(fcbaStatements).set({ analysisStatus: "failed" }).where(eq(fcbaStatements.id, stmt.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Analysis unavailable (${mapped.name}). Please retry shortly.` });
      }

      const hits = evaluateRules(extracted);
      for (const h of hits) {
        const rule = FCBA_RULES.find(r => r.id === h.ruleId)!;
        await db.insert(fcbaViolations).values({
          userId: ctx.user.id, statementId: stmt.id, ruleId: h.ruleId,
          title: rule.title, statute: rule.statute, severity: h.severity,
          excerpt: h.excerpt, annotation: rule.annotation, mark: rule.mark,
        });
      }
      // Regenerate the annotated statement (red triangles + bracket callouts).
      const annotations = hits.map(h => {
        const r = FCBA_RULES.find(x => x.id === h.ruleId)!;
        return `${r.mark === "triangle" ? "🔺 RED TRIANGLE" : r.mark === "bracket" ? "[ BRACKET ]" : "NOTE"} @ ${r.markTarget}\n${r.annotation}\nCitation: ${r.statute}`;
      }).join("\n\n---\n\n");
      const annotated = await storage.uploadFile({
        fileContent: `FCBA/TILA VIOLATION MAP — ${stmt.exhibitLabel}\nStatement: ${stmt.fileName}\nCycle: ${stmt.cycle ?? "N/A"}\nGenerated: ${new Date().toISOString()}\n\nORIGINAL STATEMENT (verbatim, unaltered)\n${bytes.toString()}\n\n${"=".repeat(72)}\nANNOTATED VIOLATIONS\n${"=".repeat(72)}\n${annotations}\n\nLegend: 🔺 = red triangle required (credit limit / summary level)  [ ] = bracket mark required (line-item level)`,
        fileName: `fcba/${ctx.user.id}/annotated-${stmt.exhibitLabel.replace(" ", "-")}-${stmt.fileName}`,
        contentType: "text/plain",
      });
      const critical = hits.filter(h => h.severity === "critical").length;
      await db.update(fcbaStatements).set({
        analysisStatus: "complete",
        annotatedFileKey: annotated.key,
        complianceScore: Math.max(0, 100 - critical * 25 - (hits.length - critical) * 8),
      }).where(eq(fcbaStatements.id, stmt.id));
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, statementId: stmt.id, type: "analyzed", message: `Analysis complete: ${hits.length} violation(s) found (${critical} critical). Annotated statement ready.` });
      return { hits, annotatedKey: annotated.key, complianceScore: Math.max(0, 100 - critical * 25 - (hits.length - critical) * 8) };
    }),

  listStatements: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id)).orderBy(desc(fcbaStatements.createdAt))),

  listViolations: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id)).orderBy(desc(fcbaViolations.createdAt))),

  statementUrl: authedQuery
    .input(z.object({ id: z.number().int().positive(), annotated: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const stmt = await getDb().query.fcbaStatements.findFirst({ where: and(eq(fcbaStatements.id, input.id), eq(fcbaStatements.userId, ctx.user.id)) });
      if (!stmt) throw new TRPCError({ code: "NOT_FOUND" });
      return storage.getPresignedUrl({ key: input.annotated && stmt.annotatedFileKey ? stmt.annotatedFileKey : stmt.fileKey, download: true });
    }),

  /** Creditor response uploaded -> AI checks boilerplate/non-response -> escalate. */
  addCreditorResponse: authedQuery
    .input(z.object({
      disputeId: z.number().int().positive(),
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(8_500_000),
      receivedDate: z.string().min(4).max(25),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dispute = await db.query.fcbaDisputes.findFirst({ where: and(eq(fcbaDisputes.id, input.disputeId), eq(fcbaDisputes.userId, ctx.user.id)) });
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      const saved = await storage.uploadFile({ fileContent: bytes, fileName: `fcba/${ctx.user.id}/responses/${Date.now()}-${input.name.replace(/[^\p{L}\p{N}._ -]/gu, "_")}` });
      const text = bytes.toString().slice(0, 60000);
      let classification = "substantive";
      try {
        const { defaultModelId } = await listModels();
        const res = await generateText({
          model: kimiGw(defaultModelId),
          system: "Classify creditor billing-error responses. Reply with exactly one word: substantive | boilerplate | nonresponse. Boilerplate = encloses copies of statements or requests forms without addressing the specific errors. Nonresponse = no reply within statutory window.",
          prompt: `Billing-error notice asserted: ${dispute.summary.slice(0, 800)}\n\nCreditor correspondence:\n${text}`,
          providerOptions: { "kimi-gw": { max_completion_tokens: 10 } },
        });
        classification = res.text.trim().toLowerCase().split(/\s+/)[0] ?? "substantive";
      } catch { classification = "substantive"; }
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, disputeId: dispute.id, type: "creditor_response", message: `Creditor response (${classification}) filed. ${classification !== "substantive" ? "FCBA non-compliance — escalation drafted." : "Under review by compliance staff.`" });
      if (classification !== "substantive") {
        await db.update(fcbaDisputes).set({ status: "escalated" }).where(eq(fcbaDisputes.id, dispute.id));
      }
      return { classification, escalated: classification !== "substantive", fileKey: saved.key };
    }),

  /** Start a dispute: drafts the §1666 notice with detected violations + deadline tracking. */
  createDispute: authedQuery
    .input(z.object({
      creditorName: z.string().min(2).max(255),
      accountLast4: z.string().min(2).max(20),
      noticeType: z.enum(["billing_error", "noncompliance_notice", "arbitration_demand"]),
      creditorReceivedDate: z.string().min(4).max(25).optional(),
      sentVia: z.string().max(60).optional(),
      trackingNumbers: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const violations = await db.select().from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id));
      const stmtCount = (await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id))).length;
      const summary = `${input.noticeType === "billing_error" ? "Formal billing-error notice" : input.noticeType === "noncompliance_notice" ? "Notice of FCBA non-compliance" : "Demand for arbitration"} to ${input.creditorName}, account ending ${input.accountLast4}: ${violations.length} violation(s) across ${stmtCount} statement(s), including §1637(b)(2)/(3)/(7)/(8) disclosure failures, §1666(b)(1)-(6) billing errors, §1666d credit-balance failure, and §1681s-2(b) unverifiable furnishing.`;
      const [{ id }] = await db.insert(fcbaDisputes).values({
        userId: ctx.user.id,
        creditorName: input.creditorName,
        accountLast4: input.accountLast4,
        noticeType: input.noticeType,
        summary,
        status: input.noticeType === "arbitration_demand" ? "arbitration" : "open",
        creditorReceivedDate: input.creditorReceivedDate ?? null,
        sentVia: input.sentVia ?? null,
        trackingNumbers: input.trackingNumbers ?? null,
        ackDeadline: input.creditorReceivedDate ? addDays(input.creditorReceivedDate, FCBA_DEADLINES.acknowledgeDays) : null,
        resolveDeadline: input.creditorReceivedDate ? addDays(input.creditorReceivedDate, FCBA_DEADLINES.resolveMaxDays) : null,
      }).$returningId();
      await db.insert(fcbaEvents).values({ userId: ctx.user.id, disputeId: id, type: "dispute_opened", message: `${input.noticeType} opened. Acknowledgment due in ${FCBA_DEADLINES.acknowledgeDays} days; resolution due within ${FCBA_DEADLINES.resolveMaxDays} days of creditor receipt.` });
      return { id, summary };
    }),

  /** Generate the dispute letter text (attorney-reviewable, never auto-sent). */
  generateDisputeLetter: authedQuery
    .input(z.object({ disputeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const dispute = await db.query.fcbaDisputes.findFirst({ where: and(eq(fcbaDisputes.id, input.disputeId), eq(fcbaDisputes.userId, ctx.user.id)) });
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });
      const violations = await db.select().from(fcbaViolations).where(eq(fcbaViolations.userId, ctx.user.id));
      const stmts = await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id));
      try {
        const { defaultModelId } = await listModels();
        const res = await generateText({
          model: kimiGw(defaultModelId),
          system: `You are the Reputation Tenability FCBA drafting assistant, preparing attorney-review packages for Miguel A. Cuevas-style billing-error files. Draft a ${dispute.noticeType.replace("_", " ")} under 15 U.S.C. §§1637(b), 1666, 1666b, 1666d and 12 C.F.R. Part 1026. Include: (1) account header; (2) itemized billing errors with statute per item; (3) documentary-evidence demand under §1026.13(a)(6)/(f)(2) (signed credit document, ledger entries, computation worksheets, any Form 1099-A); (4) relief demanded (correction, recalculation, reissued statements, removal of derogatory reporting, statutory and actual damages); (5) deadlines (30-day acknowledgment, 90-day resolution per §1666(a)); (6) preservation and arbitration notice per the Cardmember Agreement. Do NOT invent facts, dates, or citations. Cite only violations provided. Never provide definitive legal advice — this is a draft for attorney review.`,
          prompt: `Creditor: ${dispute.creditorName}. Account: ****${dispute.accountLast4}.\n\nStatements on file: ${stmts.map(s => `${s.exhibitLabel} (${s.fileName}${s.cycle ? `, cycle ${s.cycle}` : ""})`).join("; ")}\n\nDetected violations:\n${violations.map(v => `- [${v.ruleId}] ${v.title} — ${v.statute}. ${v.excerpt}`).join("\n")}`,
          providerOptions: { "kimi-gw": { max_completion_tokens: 4000 } },
        });
        return { letter: res.text };
      } catch (e) {
        const mapped = classifyAiError(e);
        return { letter: "", unavailable: `Drafting unavailable (${mapped.name}). Violations on file remain accessible; contact staff.` };
      }
    }),

  listDisputes: authedQuery.query(({ ctx }) =>
    getDb().select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, ctx.user.id)).orderBy(desc(fcbaDisputes.createdAt))),

  disputeTimeline: authedQuery
    .input(z.object({ disputeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const events = await getDb().select().from(fcbaEvents)
        .where(and(eq(fcbaEvents.userId, ctx.user.id), eq(fcbaEvents.disputeId, input.disputeId)))
        .orderBy(desc(fcbaEvents.createdAt));
      return events;
    }),

  /** Assemble the full exhibit bundle (A, B, C ... in order) for download. */
  downloadBundle: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const stmts = await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, ctx.user.id)).orderBy(fcbaStatements.createdAt);
    const disputes = await db.select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, ctx.user.id));
    const urls = await Promise.all(stmts.map(async s => ({
      exhibit: s.exhibitLabel,
      folder: s.folder,
      name: s.fileName,
      url: (await storage.getPresignedUrl({ key: s.fileKey, download: true })).url,
      annotatedUrl: s.annotatedFileKey ? (await storage.getPresignedUrl({ key: s.annotatedFileKey, download: true })).url : null,
    })));
    const manifest = `# FCBA EXHIBIT BUNDLE MANIFEST\nPrepared: ${new Date().toISOString()}\n\n${urls.map((u, i) => `${String(i + 1).padStart(2, "0")}. ${u.exhibit} — ${u.folder}\n    ${u.name}\n    Original: ${u.url}\n    ${u.annotatedUrl ? `Annotated (violation map): ${u.annotatedUrl}` : ""}`).join("\n\n")}\n\n## Open Disputes\n${disputes.map(d => `- ${d.noticeType} vs ${d.creditorName} (****${d.accountLast4}) — status: ${d.status}${d.ackDeadline ? ` — ack due ${d.ackDeadline.slice(0, 10)}` : ""}${d.resolveDeadline ? `, resolve due ${d.resolveDeadline.slice(0, 10)}` : ""}`).join("\n")}\n`;
    return { manifest, files: urls };
  }),
});
