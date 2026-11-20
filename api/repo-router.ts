/**
 * repo-router.ts — Repossession module tRPC router.
 *
 * Mirrors the FCBA module's flow: intake -> exhibit-label -> SEC due
 * diligence -> notice audit -> violation report -> demand letter ->
 * federal complaint (Wright v. Santander structure) -> special report.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { repoDocuments, repoViolations, repoCases, repoEvents } from "@db/schema";
import { REPO_RULES, DEMAND_CHECKLIST, SEC_EVIDENCE_CHAIN, CASE_ANCHORS, UCC_SELF_HELP, STATE_SELF_HELP, FDCPA_REPO } from "@contracts/repo";
import { storage } from "./lib/storage";
import { listModels, classifyAiError } from "./ai/ai-client";
import { kimiGw } from "./ai/provider";
import { generateText } from "ai";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const SYSTEM_PROMPT = `You are the Reputation Tenability Repossession Analysis Agent, embodying an SEC attorney and a consumer-law/Article 9 attorney trained on Wright v. Santander Consumer USA (M.D. Fla.) and Leal v. Toyota Motor Credit (Cal.) — per /prompts/repo-attorney-prompt.md. Apply UCC 9-609/610/611/613/615/616/620-623, Fla. Stat. ch. 679 (self-help §679.609), Cal. Com. Code Div. 9, and FDCPA 15 U.S.C. §1692a(6)/§1692f(6). The securitization blueprint: the retail contract's receivable was sold into a trust (Toyota Auto Receivables — TMVT/TMNT); if the named creditor sent notices or ordered repossession after the sale date, it likely had no present right to possession. Never invent facts, dates, docket numbers, or citations; mark missing documents as DEMAND ITEMS. Output is attorney-review work product, not legal advice.`;

async function repoExhibitLabel(userId: number): Promise<string> {
  const rows = await getDb().select().from(repoDocuments).where(eq(repoDocuments.userId, userId));
  return `Exhibit ${LETTERS[rows.length % 26]}${rows.length >= 26 ? Math.floor(rows.length / 26) : ""}`;
}

async function ask(modelPrompt: string): Promise<string> {
  const { defaultModelId } = await listModels();
  const res = await generateText({
    model: kimiGw(defaultModelId),
    system: SYSTEM_PROMPT,
    prompt: modelPrompt,
    providerOptions: { "kimi-gw": { max_completion_tokens: 4000 } },
  });
  return res.text;
}

export const repoRouter = createRouter({
  /** Upload any repo-case artifact (RC, notices, UCC-1, prospectus, PACER file). */
  uploadDocument: authedQuery
    .input(z.object({
      name: z.string().min(1).max(240),
      contentBase64: z.string().min(1).max(8_500_000),
      contentType: z.string().max(180).optional(),
      docType: z.enum(["contract", "notice_611", "notice_613", "notice_616", "default_notice", "notice_of_sale", "ucc1", "prospectus_424b5", "report_10k", "report_8k", "sales_servicing_agreement", "pacer_case", "dmv_title", "repo_work_order", "other"]),
      caseId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > 6_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Files must be under 6 MB." });
      const safeName = input.name.replace(/[^\p{L}\p{N}._ -]/gu, "_");
      const saved = await storage.uploadFile({ fileContent: bytes, fileName: `repo/${ctx.user.id}/${Date.now()}-${safeName}`, contentType: input.contentType });
      const exhibitLabel = await repoExhibitLabel(ctx.user.id);
      const [{ id }] = await db.insert(repoDocuments).values({
        userId: ctx.user.id, caseId: input.caseId ?? null, fileKey: saved.key, fileName: input.name,
        exhibitLabel, docType: input.docType, analysisStatus: "pending",
      }).$returningId();
      await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: input.caseId ?? null, documentId: id, type: "uploaded", message: `${exhibitLabel} received (${input.docType}). Filed and queued for SEC + Article 9 analysis.` });
      return { id, exhibitLabel, message: `Receipt confirmed. ${exhibitLabel} filed. The agent will analyze it against the Wright / Leal case files and the securitization blueprint.` };
    }),

  /** Open a repossession case (ties documents, violations, and drafts together). */
  openCase: authedQuery
    .input(z.object({
      creditorName: z.string().min(2).max(255),
      repoAgencyName: z.string().max(255).optional(),
      vehicle: z.string().min(2).max(255),
      vin: z.string().max(30).optional(),
      state: z.enum(["FL", "CA"]),
      repossessionDate: z.string().min(4).max(25).optional(),
      saleDate: z.string().min(4).max(25).optional(),
      rcSignDate: z.string().min(4).max(25).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [{ id }] = await getDb().insert(repoCases).values({ userId: ctx.user.id, ...input, status: "intake" }).$returningId();
      await getDb().insert(repoEvents).values({ userId: ctx.user.id, caseId: id, type: "case_opened", message: `Repossession case opened vs ${input.creditorName} (${input.vehicle}). Demand checklist queued for creditor and repo agency.` });
      return { id };
    }),

  /** SEC due diligence: prospectus -> 10-K -> 8-K -> UCC-1 -> sale & servicing. */
  secDueDiligence: authedQuery
    .input(z.object({ caseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await db.query.repoCases.findFirst({ where: and(eq(repoCases.id, input.caseId), eq(repoCases.userId, ctx.user.id)) });
      if (!kase) throw new TRPCError({ code: "NOT_FOUND" });
      const docs = await db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, input.caseId), eq(repoDocuments.userId, ctx.user.id)));
      try {
        const report = await ask(
`SEC DUE DILIGENCE REPORT — Case ${kase.creditorName} / ${kase.vehicle}.
Documents on file: ${docs.map(d => `${d.exhibitLabel} (${d.docType}: ${d.fileName})`).join("; ") || "none"}.
Evidence chain to reconstruct: ${SEC_EVIDENCE_CHAIN.map(e => `${e.doc} [${e.source}] — ${e.use}`).join(" | ")}.
Contract year target: ${kase.rcSignDate ?? "unknown — flag as DEMAND ITEM"}.
Produce: (1) the securitization timeline with exact dates from any filings provided; (2) who held the security interest on the repossession date vs. who sent notices; (3) every missing document listed as a DEMAND ITEM with retrieval cost note (EDGAR free; sale & servicing agreement via 424B5 exhibit or tender-offer copies — note the cost); (4) stale-DMV-lien / bonded-title issue if title shows a lienholder different from the secured party of record.`
        );
        await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: input.caseId, type: "sec_report", message: "SEC due diligence report complete. See report." });
        return { report };
      } catch (e) {
        const mapped = classifyAiError(e);
        return { report: "", unavailable: `SEC analysis unavailable (${mapped.name}). Retry shortly.` };
      }
    }),

  /** Full investigation: notices + contract + SEC docs -> violation report + drafts. */
  analyzeCase: authedQuery
    .input(z.object({ caseId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await db.query.repoCases.findFirst({ where: and(eq(repoCases.id, input.caseId), eq(repoCases.userId, ctx.user.id)) });
      if (!kase) throw new TRPCError({ code: "NOT_FOUND" });
      const docs = await db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, input.caseId), eq(repoDocuments.userId, ctx.user.id)));
      const corpus = docs.map(d => `${d.exhibitLabel} [${d.docType}] ${d.fileName}`).join("; ");
      try {
        const analysis = await ask(
`FULL REPOPSESSION INVESTIGATION — ${kase.creditorName}, ${kase.vehicle}${kase.vin ? ` VIN ${kase.vin}` : ""}, state ${kase.state}. Repo date: ${kase.repossessionDate ?? "unknown"}; sale date: ${kase.saleDate ?? "unknown"}; RC signed: ${kase.rcSignDate ?? "unknown"}.
Documents: ${corpus || "none uploaded — run secDueDiligence and send demand checklist first"}.
Apply every REPO rule (REPO-001 no present right to possession / §1692f(6); REPO-002 §9-613 secured-party misidentification; REPO-003 no redemption (time/place/date); REPO-004 commercially unreasonable sale 9-610/615; REPO-005 breach of peace 9-609(2); REPO-006 FDCPA repo-agent coverage; REPO-007 §9-616 deficiency; REPO-008 securitization concealment).
Statutory frame: UCC ${Object.keys(UCC_SELF_HELP).join(", ")}; ${kase.state === "FL" ? STATE_SELF_HELP.FL.citation + " — " + STATE_SELF_HELP.FL.text : STATE_SELF_HELP.CA.text}; FDCPA ${FDCPA_REPO["1692f(6)"]}.
Case anchors: Wright v. Santander (M.D. Fla.) — federal-complaint structure; Leal v. Toyota Motor Credit (Cal.) — Toyota/trust analysis.
Output EXACTLY this JSON: {"violations":[{"ruleId":"REPO-00X","title":"...","statute":"...","severity":"critical|major|minor","excerpt":"...","annotation":"..."}],"demandItems":[...],"timelineNotes":"..."}`
        );
        const json = JSON.parse(analysis.replace(/```json|```/g, "").trim());
        for (const v of json.violations ?? []) {
          await db.insert(repoViolations).values({ userId: ctx.user.id, caseId: input.caseId, ruleId: v.ruleId, title: v.title, statute: v.statute, severity: v.severity, excerpt: v.excerpt, annotation: v.annotation });
        }
        await db.update(repoCases).set({ status: "analyzed" }).where(eq(repoCases.id, input.caseId));
        await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: input.caseId, type: "analyzed", message: `Analysis complete: ${(json.violations ?? []).length} violation(s) identified. Demand items: ${(json.demandItems ?? []).length}.` });
        return json;
      } catch (e) {
        const mapped = classifyAiError(e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Analysis unavailable (${mapped.name}).` });
      }
    }),

  listCases: authedQuery.query(({ ctx }) => getDb().select().from(repoCases).where(eq(repoCases.userId, ctx.user.id)).orderBy(desc(repoCases.createdAt))),
  listViolations: authedQuery.query(({ ctx }) => getDb().select().from(repoViolations).where(eq(repoViolations.userId, ctx.user.id)).orderBy(desc(repoViolations.createdAt))),

  documentUrl: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const d = await getDb().query.repoDocuments.findFirst({ where: and(eq(repoDocuments.id, input.id), eq(repoDocuments.userId, ctx.user.id)) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND" });
      return storage.getPresignedUrl({ key: d.fileKey, download: true });
    }),

  /** Demand letter + federal complaint (Wright structure) + special report. */
  generateDraft: authedQuery
    .input(z.object({
      caseId: z.number().int().positive(),
      draftType: z.enum(["notice_of_demand", "federal_complaint", "special_report"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await db.query.repoCases.findFirst({ where: and(eq(repoCases.id, input.caseId), eq(repoCases.userId, ctx.user.id)) });
      if (!kase) throw new TRPCError({ code: "NOT_FOUND" });
      const violations = await db.select().from(repoViolations).where(and(eq(repoViolations.caseId, input.caseId), eq(repoViolations.userId, ctx.user.id)));
      const docs = await db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, input.caseId), eq(repoDocuments.userId, ctx.user.id)));
      try {
        const letter = await ask(
`DRAFT: ${input.draftType} — ${kase.creditorName}${kase.repoAgencyName ? ` and repossession agency ${kase.repoAgencyName}` : ""}; vehicle ${kase.vehicle}${kase.vin ? `, VIN ${kase.vin}` : ""}; state ${kase.state}; repo ${kase.repossessionDate ?? "unknown"}; sale ${kase.saleDate ?? "unknown"}; RC signed ${kase.rcSignDate ?? "unknown"}.
Exhibits: ${docs.map(d => `${d.exhibitLabel} (${d.docType}: ${d.fileName})`).join("; ") || "none"}.
Violations: ${violations.map(v => `[${v.ruleId}] ${v.title} — ${v.statute}. ${v.excerpt}`).join(" | ") || "run analyzeCase first"}.
${input.draftType === "notice_of_demand" ? "Draft the NOTICE OF DEMAND: attach the full DEMAND_CHECKLIST (original RC, all 611/613/616 notices, default notice, notice of sale with time/place/date, UCC-1, authority documentation, sale & servicing agreement, repo work order), 30-day cure, preserve-vehicle/records demand, and FDCPA + Article 9 reservation of rights." : ""}
${input.draftType === "federal_complaint" ? "Draft the FEDERAL COMPLAINT following the Wright v. Santander (M.D. Fla.) structure: jurisdiction/venue, parties (including repo agency as FDCPA debt collector), factual background (securitization timeline from SEC filings), counts (wrongful repossession §1692f(6), Article 9 notice failures 9-611/613/616, commercially unreasonable sale 9-610/615, FDCPA 1692d/e, state-law conversion/statutory claims per FL/CA), damages, prayer. Attorney-review work product; leave caption placeholders." : ""}
${input.draftType === "special_report" ? "Draft the SPECIAL REPORT: how the creditor elected securitization (sale of receivables to the trust — cite the 424B5/10-K/8-K/UCC-1 on file) and therefore retained no security interest, yet repossessed the collateral as creditor/secured party; how each §9-611/613 notice materially misrepresented its character and capacity; evidence table mapping each exhibit to each conclusion; note any bonded-title/DMV-lien inconsistency." : ""}`
        );
        await db.insert(repoEvents).values({ userId: ctx.user.id, caseId: input.caseId, type: "draft", message: `${input.draftType} drafted for attorney review.` });
        return { letter };
      } catch (e) {
        const mapped = classifyAiError(e);
        return { letter: "", unavailable: `Drafting unavailable (${mapped.name}).` };
      }
    }),

  /** Repo-service / creditor document demand sender (generates the checklist letter). */
  generateDocumentDemand: authedQuery
    .input(z.object({ caseId: z.number().int().positive(), sendTo: z.enum(["creditor", "repo_agency", "both"]) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const kase = await db.query.repoCases.findFirst({ where: and(eq(repoCases.id, input.caseId), eq(repoCases.userId, ctx.user.id)) });
      if (!kase) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        const letter = await ask(
`Draft a certified-mail DOCUMENT DEMAND for ${input.sendTo} in the matter of ${kase.creditorName} / ${kase.vehicle}${kase.vin ? ` VIN ${kase.vin}` : ""}.
Demand the following, itemized, within 30 days: ${DEMAND_CHECKLIST.join(" | ")}.
Reference the UCC self-help frame: ${UCC_SELF_HELP["9-609"]} ${UCC_SELF_HELP["9-611"]} ${UCC_SELF_HELP["9-613"]}; Florida: ${STATE_SELF_HELP.FL.citation}; FDCPA §1692f(6). Reserve all rights; note non-production supports inference of no present right to possession (Wright v. Santander, M.D. Fla.).`
        );
        return { letter };
      } catch (e) {
        return { letter: "", unavailable: "Drafting unavailable. Retry." };
      }
    }),

  caseTimeline: authedQuery
    .input(z.object({ caseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) =>
      getDb().select().from(repoEvents).where(and(eq(repoEvents.caseId, input.caseId), eq(repoEvents.userId, ctx.user.id))).orderBy(desc(repoEvents.createdAt))),

  caseBundle: authedQuery
    .input(z.object({ caseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const docs = await db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, input.caseId), eq(repoDocuments.userId, ctx.user.id))).orderBy(repoDocuments.createdAt);
      const files = await Promise.all(docs.map(async d => ({
        exhibit: d.exhibitLabel, docType: d.docType, name: d.fileName,
        url: (await storage.getPresignedUrl({ key: d.fileKey, download: true })).url,
      })));
      const kase = await db.query.repoCases.findFirst({ where: eq(repoCases.id, input.caseId) });
      const manifest = `# REPOSSESSION CASE BUNDLE — ${kase?.creditorName ?? ""} / ${kase?.vehicle ?? ""}\n${files.map((f, i) => `${String(i + 1).padStart(2, "0")}. ${f.exhibit} [${f.docType}] ${f.name}\n    ${f.url}`).join("\n")}\n`;
      return { manifest, files };
    }),
});
