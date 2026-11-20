/**
 * repo-router.ts — Self-help repossession module (Article 9 + FDCPA + SEC).
 *
 * Flow: open case → file exhibits (auto-labeled) → answer the facts
 * questionnaire (optionally pre-filled by Claude reading the notices) →
 * deterministic REPO-001…008 screening → drafts (document demand, notice of
 * demand, federal complaint skeleton, special report, SEC due-diligence plan)
 * with AI assistance and a template fallback → ZIP case bundle.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { repoCases, repoDocuments, repoDrafts, repoEvents, repoViolations } from "@db/schema";
import { CASE_ANCHORS, DEMAND_CHECKLIST, FDCPA_REPO, SEC_EVIDENCE_CHAIN, STATE_SELF_HELP, UCC_SELF_HELP } from "@contracts/repo";
import { EMPTY_REPO_FACTS, RepoFactsSchema, evaluateRepo, missingEvidence, redemptionWindow, repoRiskScore, type RepoFacts } from "@contracts/repo-engine";
import { exhibitLabel } from "@contracts/fcba-engine";
import { blob, decodeUpload, makeKey, sniffContentType } from "./lib/blob";
import { AiUnavailable, extractStructured, generateDraft, type Attachment } from "./ai/llm";
import type { RepoCase, RepoViolation, RepoDocument } from "@db/schema";

const DOC_TYPES = ["contract", "notice_611", "notice_613", "notice_616", "default_notice", "notice_of_sale", "ucc1", "prospectus_424b5", "report_10k", "report_8k", "sales_servicing_agreement", "pacer_case", "dmv_title", "repo_work_order", "other"] as const;
const DRAFT_TYPES = ["document_demand", "notice_of_demand", "federal_complaint", "special_report", "sec_due_diligence"] as const;
type DraftType = (typeof DRAFT_TYPES)[number];
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);

function loadAttorneyPrompt(): string {
  try {
    return readFileSync(path.resolve(process.cwd(), "prompts/repo-attorney-prompt.md"), "utf8");
  } catch {
    return "You are the Reputation Tenability Repossession Analysis Agent (SEC + Article 9 consumer-law review).";
  }
}

const SYSTEM_PROMPT = `${loadAttorneyPrompt()}

Operating constraints for this portal:
- Output is attorney-review work product for a licensed attorney, never advice to the consumer.
- Use only the facts, findings, and exhibits supplied in the request. Where a fact is missing, write [DEMAND ITEM: …] or [TO CONFIRM: …] rather than assuming it.
- Securitization does not by itself defeat a servicer's authority to repossess on the trust's behalf; present REPO-001/REPO-008 as issues to prove with the Sale & Servicing Agreement, not as conclusions.
- Never invent docket numbers, quotations, or case holdings. Cite cases only by the names provided.
- Plain text only, no markdown tables.`;

async function ownCase(userId: number, id: number): Promise<RepoCase> {
  const kase = await getDb().query.repoCases.findFirst({ where: and(eq(repoCases.id, id), eq(repoCases.userId, userId)) });
  if (!kase) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found." });
  return kase;
}

function factsOf(kase: RepoCase): RepoFacts {
  const base: RepoFacts = { ...EMPTY_REPO_FACTS, state: kase.state, repossessionDate: kase.repossessionDate?.slice(0, 10) ?? null, saleDate: kase.saleDate?.slice(0, 10) ?? null };
  if (!kase.facts) return base;
  try {
    return RepoFactsSchema.parse({ ...base, ...JSON.parse(kase.facts) });
  } catch {
    return base;
  }
}

function caseHeader(kase: RepoCase) {
  return `${kase.creditorName}${kase.repoAgencyName ? ` / repossession agency ${kase.repoAgencyName}` : ""}; vehicle ${kase.vehicle}${kase.vin ? `, VIN ${kase.vin}` : ""}; state ${kase.state}; contract signed ${kase.rcSignDate ?? "[TO CONFIRM]"}; repossessed ${kase.repossessionDate ?? "[TO CONFIRM]"}; sale ${kase.saleDate ?? "[TO CONFIRM]"}`;
}

/** Deterministic drafts — always available, citation-safe. */
export function templateDraft(type: DraftType, kase: RepoCase, violations: Pick<RepoViolation, "ruleId" | "title" | "statute" | "excerpt">[], docs: Pick<RepoDocument, "exhibitLabel" | "docType" | "fileName">[], consumer: string, sendTo = "both"): string {
  const date = today();
  const exhibits = docs.length ? docs.map((d) => `- ${d.exhibitLabel}: ${d.fileName} (${d.docType.replaceAll("_", " ")})`).join("\n") : "- [No exhibits on file yet]";
  const findings = violations.length
    ? violations.map((v, i) => `${i + 1}. ${v.title} [${v.ruleId}]\n   Authority: ${v.statute}\n   Basis: ${v.excerpt}`).join("\n\n")
    : "[Run the screening questionnaire to list findings.]";
  const recipients = sendTo === "creditor" ? kase.creditorName : sendTo === "repo_agency" ? kase.repoAgencyName ?? "[Repossession agency]" : `${kase.creditorName}${kase.repoAgencyName ? `\n${kase.repoAgencyName}` : ""}`;
  const state = STATE_SELF_HELP[kase.state];
  const footer = "\n— Draft prepared for attorney review. Not legal advice. Verify every fact, date, and citation before use. —";
  switch (type) {
    case "document_demand":
      return `${date}\n\nVIA CERTIFIED MAIL — RETURN RECEIPT REQUESTED\n\n${recipients}\n\nRe: Demand for documents — ${caseHeader(kase)}\nDebtor: ${consumer}\n\nPlease produce the following within 30 days of receipt:\n\n${DEMAND_CHECKLIST.map((item, i) => `${i + 1}. ${item}`).join("\n")}\n\nThis request concerns the repossession and any disposition of the vehicle under UCC Article 9 Part 6 (${state.citation} and companion sections) and the Fair Debt Collection Practices Act, including 15 U.S.C. §1692f(6). Please preserve all records, recordings, GPS and dispatch data, photographs, and communications relating to this account and the repossession.\n\nAll rights are reserved.\n\nSincerely,\n\n\n${consumer}${footer}`;
    case "notice_of_demand":
      return `${date}\n\nVIA CERTIFIED MAIL — RETURN RECEIPT REQUESTED\n\n${recipients}\n\nRe: NOTICE OF DEMAND — ${caseHeader(kase)}\n\nThis notice identifies conduct in connection with the repossession and disposition of the vehicle that appears to violate Article 9 and the FDCPA:\n\n${findings}\n\nDEMAND\n\n1. Produce the documents listed in the enclosed demand, including proof of your authority to repossess on the repossession date.\n2. Preserve the vehicle (if not yet sold) and all records.\n3. Cease collection of any deficiency pending production and review.\n4. Respond in writing within 30 days.\n\nEXHIBITS\n\n${exhibits}\n\nSincerely,\n\n\n${consumer}${footer}`;
    case "federal_complaint":
      return `UNITED STATES DISTRICT COURT\n[DISTRICT — e.g., ${kase.state === "FL" ? "MIDDLE DISTRICT OF FLORIDA" : "CENTRAL DISTRICT OF CALIFORNIA"}]\n\n${consumer.toUpperCase()}, Plaintiff,\nv.\n${kase.creditorName.toUpperCase()}${kase.repoAgencyName ? `, and ${kase.repoAgencyName.toUpperCase()}` : ""}, Defendants.\n\nCase No. [__________]\n\nCOMPLAINT AND DEMAND FOR JURY TRIAL\n(Structure follows ${CASE_ANCHORS[0].name}, ${CASE_ANCHORS[0].court})\n\nI. JURISDICTION AND VENUE\n[28 U.S.C. §1331 (FDCPA, 15 U.S.C. §1692k(d)); supplemental jurisdiction, 28 U.S.C. §1367; venue, 28 U.S.C. §1391(b).]\n\nII. PARTIES\n[Plaintiff; secured creditor/servicer; repossession agency as a "debt collector" under 15 U.S.C. §1692a(6) as applied to §1692f(6).]\n\nIII. FACTUAL ALLEGATIONS\n[Contract, assignment/securitization timeline from SEC filings, default, repossession on ${kase.repossessionDate ?? "[date]"}, notices, disposition on ${kase.saleDate ?? "[date]"}.]\n\nIV. SCREENING FINDINGS TO DEVELOP INTO COUNTS\n\n${findings}\n\nV. CLAIMS FOR RELIEF\nCount I — 15 U.S.C. §1692f(6) (repossession agency)\nCount II — UCC Article 9 (${state.citation}; §§9-610, 9-611, 9-613, 9-616, 9-625)\nCount III — State-law conversion / statutory claims [counsel to confirm]\n\nVI. PRAYER FOR RELIEF\n[Actual and statutory damages; UCC 9-625(c)(2) minimum damages for consumer goods; costs and fees under 15 U.S.C. §1692k.]\n\nJURY DEMAND\n\nEXHIBITS\n${exhibits}\n${footer}`;
    case "special_report":
      return `SPECIAL REPORT — SECURITIZATION AND AUTHORITY TO REPOSSESS\n${caseHeader(kase)}\nPrepared ${date}\n\n1. QUESTION PRESENTED\nWhether the entity that ordered the repossession and sent the Article 9 notices held, or acted under authority from the holder of, the security interest on the repossession date.\n\n2. EVIDENCE CHAIN\n${SEC_EVIDENCE_CHAIN.map((e, i) => `${i + 1}. ${e.doc} — ${e.source}\n   Use: ${e.use}`).join("\n")}\n\n3. SCREENING FINDINGS\n${findings}\n\n4. EXHIBIT MAP\n${exhibits}\n\n5. OPEN ITEMS\n[List each document still to be obtained and what it would prove.]\n${footer}`;
    case "sec_due_diligence":
      return `SEC DUE DILIGENCE PLAN\n${caseHeader(kase)}\nPrepared ${date}\n\nSteps (EDGAR full-text search is free; the Sale & Servicing Agreement is usually an exhibit to the 8-K filed at closing):\n\n${SEC_EVIDENCE_CHAIN.map((e, i) => `${i + 1}. Obtain: ${e.doc}\n   Where: ${e.source}\n   Proves: ${e.use}`).join("\n\n")}\n\nTarget contract year: ${kase.rcSignDate?.slice(0, 4) ?? "[TO CONFIRM]"}.\nCompare the trust closing / cutoff date with the contract signing date and the repossession date, then compare the secured party of record (UCC-1 / title) with the sender of each notice.\n${footer}`;
  }
}

async function attachmentsFor(userId: number, caseId: number, limit = 8): Promise<Attachment[]> {
  const docs = await getDb().select().from(repoDocuments).where(and(eq(repoDocuments.caseId, caseId), eq(repoDocuments.userId, userId))).orderBy(asc(repoDocuments.createdAt)).limit(limit);
  const out: Attachment[] = [];
  for (const d of docs) {
    const ct = d.contentType ?? "application/octet-stream";
    if (!(ct === "application/pdf" || ct.startsWith("image/") || ct.startsWith("text/"))) continue;
    out.push({ bytes: await blob().get(d.fileKey), contentType: ct, title: `${d.exhibitLabel} — ${d.fileName}` });
  }
  return out;
}

async function screen(userId: number, kase: RepoCase, facts: RepoFacts) {
  const db = getDb();
  const hits = evaluateRepo(facts);
  await db.delete(repoViolations).where(and(eq(repoViolations.caseId, kase.id), eq(repoViolations.userId, userId), eq(repoViolations.basis, "rule")));
  if (hits.length) {
    await db.insert(repoViolations).values(hits.map((h) => ({ userId, caseId: kase.id, ruleId: h.ruleId, title: h.title, statute: h.statute, severity: h.severity, excerpt: h.excerpt, annotation: h.annotation, basis: "rule" as const })));
  }
  const score = repoRiskScore(hits);
  await db.update(repoCases).set({
    facts: JSON.stringify(facts),
    riskScore: score,
    state: facts.state,
    repossessionDate: facts.repossessionDate,
    saleDate: facts.saleDate,
    status: kase.status === "intake" || kase.status === "demand_sent" ? "analyzed" : kase.status,
  }).where(eq(repoCases.id, kase.id));
  await db.insert(repoEvents).values({ userId, caseId: kase.id, type: "analyzed", message: `Screening complete: ${hits.length} indicator(s), risk score ${score}/100.` });
  return { hits, riskScore: score };
}

export const repoRouter = createRouter({
  openCase: authedQuery
    .input(z.object({
      creditorName: z.string().trim().min(2).max(255),
      repoAgencyName: z.string().trim().max(255).optional(),
      vehicle: z.string().trim().min(2).max(255),
      vin: z.string().trim().max(30).optional(),
      state: z.enum(["FL", "CA"]),
      repossessionDate: isoDay.optional(),
      saleDate: isoDay.optional(),
      rcSignDate: isoDay.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const values = { ...input, repoAgencyName: input.repoAgencyName || null, vin: input.vin || null };
      const [{ id }] = await getDb().insert(repoCases).values({ userId: ctx.user.id, ...values, status: "intake" }).$returningId();
      await getDb().insert(repoEvents).values({ userId: ctx.user.id, caseId: id, type: "case_opened", message: `Repossession case opened: ${input.creditorName} — ${input.vehicle}.` });
      return { id };
    }),

  updateCase: authedQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["intake", "demand_sent", "analyzed", "drafted", "arbitration", "resolved"]) }))
    .mutation(async ({ ctx, input }) => {
      const kase = await ownCase(ctx.user.id, input.id);
      await getDb().update(repoCases).set({ status: input.status }).where(eq(repoCases.id, kase.id));
      await getDb().insert(repoEvents).values({ userId: ctx.user.id, caseId: kase.id, type: "status", message: `Status changed to ${input.status.replaceAll("_", " ")}.` });
      return { ok: true };
    }),

  listCases: authedQuery.query(({ ctx }) =>
    getDb().select().from(repoCases).where(eq(repoCases.userId, ctx.user.id)).orderBy(desc(repoCases.createdAt))),

  caseDetail: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await ownCase(ctx.user.id, input.id);
      const [documents, violations, drafts, events] = await Promise.all([
        db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, kase.id), eq(repoDocuments.userId, ctx.user.id))).orderBy(asc(repoDocuments.createdAt)),
        db.select().from(repoViolations).where(and(eq(repoViolations.caseId, kase.id), eq(repoViolations.userId, ctx.user.id))),
        db.select().from(repoDrafts).where(and(eq(repoDrafts.caseId, kase.id), eq(repoDrafts.userId, ctx.user.id))).orderBy(desc(repoDrafts.updatedAt)),
        db.select().from(repoEvents).where(and(eq(repoEvents.caseId, kase.id), eq(repoEvents.userId, ctx.user.id))).orderBy(desc(repoEvents.createdAt)).limit(50),
      ]);
      const facts = factsOf(kase);
      return {
        case: kase,
        facts,
        documents,
        violations,
        drafts,
        events,
        missing: missingEvidence(facts, documents.map((d) => d.docType)),
        redemption: redemptionWindow(facts, today()),
      };
    }),

  uploadDocument: authedQuery
    .input(z.object({
      caseId: z.number().int().positive(),
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(21_000_000),
      contentType: z.string().max(180).optional(),
      docType: z.enum(DOC_TYPES),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await ownCase(ctx.user.id, input.caseId);
      let bytes: Uint8Array;
      try {
        bytes = decodeUpload(input.contentBase64);
      } catch (error) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: (error as Error).message });
      }
      const contentType = sniffContentType(bytes, input.contentType);
      const count = (await db.select({ id: repoDocuments.id }).from(repoDocuments).where(and(eq(repoDocuments.userId, ctx.user.id), eq(repoDocuments.caseId, kase.id)))).length;
      const label = exhibitLabel(count);
      const saved = await blob().put(makeKey(`repo/${ctx.user.id}/${kase.id}`, input.name), bytes, contentType);
      const [{ id }] = await db.insert(repoDocuments).values({
        userId: ctx.user.id, caseId: kase.id, fileKey: saved.key, fileName: input.name, exhibitLabel: label,
        docType: input.docType, contentType, size: saved.size, analysisStatus: "complete",
      }).$returningId();
      await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: kase.id, documentId: id, type: "uploaded", message: `${label} received (${input.docType.replaceAll("_", " ")}): ${input.name}.` });
      return { id, exhibitLabel: label, message: `Receipt confirmed. ${input.name} is filed as ${label}.` };
    }),

  removeDocument: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await getDb().query.repoDocuments.findFirst({ where: and(eq(repoDocuments.id, input.id), eq(repoDocuments.userId, ctx.user.id)) });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await getDb().delete(repoDocuments).where(eq(repoDocuments.id, doc.id));
      await blob().remove(doc.fileKey).catch(() => undefined);
      return { ok: true };
    }),

  /** Save the questionnaire and run the deterministic screen. */
  saveFacts: authedQuery
    .input(z.object({ caseId: z.number().int().positive(), facts: RepoFactsSchema }))
    .mutation(async ({ ctx, input }) => screen(ctx.user.id, await ownCase(ctx.user.id, input.caseId), input.facts)),

  previewRules: authedQuery
    .input(z.object({ facts: RepoFactsSchema }))
    .query(({ input }) => {
      const hits = evaluateRepo(input.facts);
      return { hits, riskScore: repoRiskScore(hits) };
    }),

  /** Claude reads the uploaded notices/filings and proposes questionnaire answers. */
  suggestFacts: authedQuery
    .input(z.object({ caseId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const kase = await ownCase(ctx.user.id, input.caseId);
      const attachments = await attachmentsFor(ctx.user.id, kase.id);
      if (!attachments.length) return { facts: null, notice: "Upload the contract, notices, or SEC filings first (PDF, image, or text)." };
      try {
        const suggested = await extractStructured({
          schema: RepoFactsSchema,
          system: `You read repossession case documents (retail installment contracts, Article 9 notices, title/UCC records, SEC filings for auto-receivables trusts) and extract facts exactly as stated. Use "unknown" or null for anything not shown; never infer. Dates as YYYY-MM-DD. Breach-of-peace and misrepresentation flags are true only if a document describes that conduct.`,
          prompt: `Case: ${caseHeader(kase)}. Extract the questionnaire facts from the attached exhibits.`,
          attachments,
        });
        return { facts: { ...suggested, state: kase.state }, notice: "Suggested answers loaded — review each one before saving." };
      } catch (error) {
        return { facts: null, notice: error instanceof AiUnavailable ? `${error.message} Answer the questionnaire manually.` : "Could not read the documents automatically. Answer the questionnaire manually." };
      }
    }),

  generateDraft: authedQuery
    .input(z.object({ caseId: z.number().int().positive(), draftType: z.enum(DRAFT_TYPES), sendTo: z.enum(["creditor", "repo_agency", "both"]).default("both"), useAi: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await ownCase(ctx.user.id, input.caseId);
      const [violations, docs] = await Promise.all([
        db.select().from(repoViolations).where(and(eq(repoViolations.caseId, kase.id), eq(repoViolations.userId, ctx.user.id))),
        db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, kase.id), eq(repoDocuments.userId, ctx.user.id))).orderBy(asc(repoDocuments.createdAt)),
      ]);
      const consumer = ctx.user.name || "Debtor";
      const template = templateDraft(input.draftType, kase, violations, docs, consumer, input.sendTo);
      let body = template;
      let source: "ai" | "template" = "template";
      let notice: string | undefined;
      if (input.useAi) {
        try {
          const facts = factsOf(kase);
          body = await generateDraft({
            system: SYSTEM_PROMPT,
            prompt: `Draft type: ${input.draftType.replaceAll("_", " ")}.\nCase: ${caseHeader(kase)}.\nQuestionnaire facts (JSON): ${JSON.stringify(facts)}\nStatutory frame: UCC ${Object.entries(UCC_SELF_HELP).map(([k, v]) => `${k}: ${v}`).join(" | ")}; ${STATE_SELF_HELP[kase.state].citation}: ${STATE_SELF_HELP[kase.state].text}; ${FDCPA_REPO["1692f(6)"]}\nCase anchors (cite by name only): ${CASE_ANCHORS.map((c) => `${c.name} (${c.court}) — ${c.role}`).join("; ")}.\n\nExpand the following template into a complete, polished draft. Keep its sections and every citation; fill bracketed placeholders only from the facts above, otherwise leave them bracketed. Keep the closing attorney-review line.\n\n---\n${template}`,
            attachments: input.draftType === "special_report" || input.draftType === "federal_complaint" ? await attachmentsFor(ctx.user.id, kase.id, 5) : [],
            effort: "high",
          });
          source = "ai";
        } catch (error) {
          notice = error instanceof AiUnavailable ? `${error.message} A template draft was generated instead.` : "AI drafting failed; a template draft was generated instead.";
        }
      }
      const [{ id }] = await db.insert(repoDrafts).values({ userId: ctx.user.id, caseId: kase.id, draftType: input.draftType, body, source }).$returningId();
      await db.update(repoCases).set({ status: input.draftType === "document_demand" && kase.status === "intake" ? "demand_sent" : kase.status === "analyzed" ? "drafted" : kase.status }).where(eq(repoCases.id, kase.id));
      await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: kase.id, type: "draft", message: `${input.draftType.replaceAll("_", " ")} drafted (${source === "ai" ? "AI-assisted" : "template"}) for attorney review.` });
      return { id, body, source, notice };
    }),

  saveDraft: authedQuery
    .input(z.object({ id: z.number().int().positive(), body: z.string().min(20).max(120_000) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await getDb().query.repoDrafts.findFirst({ where: and(eq(repoDrafts.id, input.id), eq(repoDrafts.userId, ctx.user.id)) });
      if (!draft) throw new TRPCError({ code: "NOT_FOUND" });
      await getDb().update(repoDrafts).set({ body: input.body, source: "edited" }).where(eq(repoDrafts.id, draft.id));
      return { ok: true };
    }),

  reference: authedQuery.query(() => ({ checklist: DEMAND_CHECKLIST, secChain: SEC_EVIDENCE_CHAIN, anchors: CASE_ANCHORS, docTypes: DOC_TYPES })),
});
