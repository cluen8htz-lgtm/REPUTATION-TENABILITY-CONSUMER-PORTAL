/**
 * repo-engine.ts — deterministic repossession screening (FL + CA).
 *
 * Turns the client's answers (and facts read from uploaded notices) into
 * REPO-001…008 screening indicators. Indicators are *issues to investigate*,
 * worded conservatively: e.g. a receivable sold into a securitization trust is
 * commonly still serviced — and lawfully repossessed — by the original lender
 * acting for the trust, so REPO-001/008 flag a question for the SEC/Article 9
 * review rather than a conclusion. Attorney review is always required.
 */
import { z } from "zod";
import { REPO_RULES, STATE_SELF_HELP } from "./repo";
import { addDaysIso, daysBetween, type Severity } from "./fcba-engine";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const tri = z.enum(["yes", "no", "unknown"]);

export const RepoFactsSchema = z.object({
  state: z.enum(["FL", "CA"]),
  repossessionDate: isoDate,
  saleDate: isoDate,
  noticeOfSaleReceived: tri,
  noticeDate: isoDate,
  noticeStatesTimePlaceOrMethod: tri,
  noticeIdentifiesSecuredParty: tri,
  noticeSenderName: z.string().max(255).nullable(),
  securedPartyOfRecord: z.string().max(255).nullable(),
  receivableSoldToTrustDate: isoDate,
  trustName: z.string().max(255).nullable(),
  dmvLienholder: z.string().max(255).nullable(),
  breachOfPeace: z.object({
    objectedAtScene: z.boolean(),
    enteredClosedGarageOrGate: z.boolean(),
    threatsOrConfrontation: z.boolean(),
    policeAssistedWithoutCourtOrder: z.boolean(),
  }),
  repoAgentMisrepresentation: z.boolean(),
  salePrice: z.number().finite().nullable(),
  estimatedValue: z.number().finite().nullable(),
  saleType: z.enum(["public", "private", "unknown"]),
  deficiencyDemanded: tri,
  deficiencyExplanationReceived: tri,
});
export type RepoFacts = z.infer<typeof RepoFactsSchema>;

export const EMPTY_REPO_FACTS: RepoFacts = {
  state: "FL",
  repossessionDate: null,
  saleDate: null,
  noticeOfSaleReceived: "unknown",
  noticeDate: null,
  noticeStatesTimePlaceOrMethod: "unknown",
  noticeIdentifiesSecuredParty: "unknown",
  noticeSenderName: null,
  securedPartyOfRecord: null,
  receivableSoldToTrustDate: null,
  trustName: null,
  dmvLienholder: null,
  breachOfPeace: { objectedAtScene: false, enteredClosedGarageOrGate: false, threatsOrConfrontation: false, policeAssistedWithoutCourtOrder: false },
  repoAgentMisrepresentation: false,
  salePrice: null,
  estimatedValue: null,
  saleType: "unknown",
  deficiencyDemanded: "unknown",
  deficiencyExplanationReceived: "unknown",
};

export type RepoHit = {
  ruleId: (typeof REPO_RULES)[number]["id"];
  title: string;
  statute: string;
  severity: Severity;
  excerpt: string;
  annotation: string;
};

const norm = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** California's Notice of Intent must precede disposition by at least 15 days (Cal. Civ. Code §2983.2). */
export const CA_NOI_MIN_DAYS = 15;
/** UCC 9-612(b) 10-day safe harbor applies to non-consumer transactions; used here only as a screening yardstick. */
export const SAFE_HARBOR_DAYS = 10;

export function evaluateRepo(facts: RepoFacts): RepoHit[] {
  const hits: RepoHit[] = [];
  const fire = (id: RepoHit["ruleId"], severity: Severity, excerpt: string, statuteExtra?: string) => {
    const rule = REPO_RULES.find((item) => item.id === id)!;
    hits.push({ ruleId: id, title: rule.title, statute: statuteExtra ? `${rule.statute}; ${statuteExtra}` : rule.statute, severity, excerpt, annotation: rule.annotation });
  };
  const sold = facts.receivableSoldToTrustDate;
  const sender = norm(facts.noticeSenderName);
  const record = norm(facts.securedPartyOfRecord);

  if (sold && facts.repossessionDate && daysBetween(sold, facts.repossessionDate) > 0) {
    fire("REPO-001", "major", `Receivable appears to have been sold${facts.trustName ? ` to ${facts.trustName}` : " to a trust"} on ${sold}, before the ${facts.repossessionDate} repossession. Verify in the Sale & Servicing Agreement whether the repossessing entity held authority (servicers often act for the trust).`);
  }
  if (facts.noticeIdentifiesSecuredParty === "no" || (sender && record && sender !== record)) {
    fire("REPO-002", "major", sender && record && sender !== record
      ? `Notice sent by "${facts.noticeSenderName}" but the secured party of record is "${facts.securedPartyOfRecord}".`
      : "The disposition notice does not identify the secured party.");
  }
  const noticeGap = facts.noticeDate && facts.saleDate ? daysBetween(facts.noticeDate, facts.saleDate) : null;
  if (facts.noticeOfSaleReceived === "no") {
    fire("REPO-003", "critical", "No notification of disposition was received before the sale, so the right to redeem could not be exercised.");
  } else if (facts.noticeStatesTimePlaceOrMethod === "no") {
    fire("REPO-003", "critical", "The notice did not state the time and place of a public sale or the date after which a private sale would occur.");
  } else if (noticeGap !== null && facts.state === "CA" && noticeGap < CA_NOI_MIN_DAYS) {
    fire("REPO-003", "critical", `Notice of Intent dated ${facts.noticeDate} preceded the ${facts.saleDate} sale by only ${noticeGap} day(s); California requires at least ${CA_NOI_MIN_DAYS}.`, "Cal. Civ. Code §2983.2");
  } else if (noticeGap !== null && noticeGap < SAFE_HARBOR_DAYS) {
    fire("REPO-003", "major", `Notice dated ${facts.noticeDate} preceded the ${facts.saleDate} sale by only ${noticeGap} day(s) — shorter than the ${SAFE_HARBOR_DAYS}-day UCC 9-612 benchmark; timeliness is a question of fact.`);
  }
  if (facts.salePrice !== null && facts.estimatedValue && facts.salePrice < facts.estimatedValue * 0.6) {
    const pct = Math.round((facts.salePrice / facts.estimatedValue) * 100);
    fire("REPO-004", "major", `Sale price $${facts.salePrice.toLocaleString()} is ${pct}% of the estimated $${facts.estimatedValue.toLocaleString()} value — a low price alone is not dispositive but invites scrutiny of every aspect of the sale.`);
  } else if (facts.saleType === "private" && facts.noticeStatesTimePlaceOrMethod !== "yes") {
    fire("REPO-004", "minor", "Private sale without a disclosed method of disposition.");
  }
  const bop = facts.breachOfPeace;
  const bopReasons = [
    bop.objectedAtScene && "the debtor objected at the scene",
    bop.enteredClosedGarageOrGate && "agents entered a closed garage or gate",
    bop.threatsOrConfrontation && "threats or confrontation occurred",
    bop.policeAssistedWithoutCourtOrder && "police assisted without a court order",
  ].filter(Boolean) as string[];
  if (bopReasons.length) {
    fire("REPO-005", "critical", `Reported: ${bopReasons.join("; ")}.`, STATE_SELF_HELP[facts.state].citation);
  }
  if (facts.repoAgentMisrepresentation) {
    fire("REPO-006", "major", "The repossession agent reportedly made threats or false statements about its right to take the vehicle.");
  }
  if (facts.deficiencyDemanded === "yes" && facts.deficiencyExplanationReceived !== "yes") {
    fire("REPO-007", "major", "A deficiency balance was demanded without the explanation of how it was calculated.");
  }
  if (sold && (facts.noticeIdentifiesSecuredParty === "no" || (sender && record && sender !== record))) {
    fire("REPO-008", "major", "SEC filings indicate the receivable was securitized, yet the notices did not disclose the trust as secured party. Confirm against the 424B5, 10-K, 8-K, and UCC-1.");
  }
  return hits;
}

export function repoRiskScore(hits: Pick<RepoHit, "severity">[]): number {
  return Math.min(100, hits.reduce((total, hit) => total + (hit.severity === "critical" ? 30 : hit.severity === "major" ? 15 : 5), 0));
}

/** Items the client should still gather, derived from what is unknown. */
export function missingEvidence(facts: RepoFacts, uploadedDocTypes: string[]): string[] {
  const has = (type: string) => uploadedDocTypes.includes(type);
  const out: string[] = [];
  if (!has("contract")) out.push("Retail installment contract (RC) and amendments");
  if (!has("notice_611") && !has("notice_of_sale")) out.push("Notice of intent / notice of disposition (§9-611)");
  if (facts.deficiencyDemanded === "yes" && !has("notice_616")) out.push("Deficiency explanation (§9-616) — request it in writing");
  if (!has("ucc1") && !has("dmv_title")) out.push("Title / UCC-1 showing the lienholder of record");
  if (!has("prospectus_424b5")) out.push("424B5 prospectus for the auto-receivables trust (SEC EDGAR)");
  if (!has("sales_servicing_agreement")) out.push("Sale & Servicing Agreement (424B5 exhibit or 8-K)");
  if (!has("repo_work_order")) out.push("Repossession agency work order and assignment");
  if (!facts.repossessionDate) out.push("Exact date and time of the repossession");
  return out;
}

/** Redemption remains available until disposition (UCC 9-623(c)). */
export function redemptionWindow(facts: RepoFacts, todayIso: string): { open: boolean; daysLeft: number | null; message: string } {
  if (!facts.saleDate) return { open: true, daysLeft: null, message: "No sale date known — the right to redeem generally continues until the vehicle is disposed of." };
  const daysLeft = daysBetween(todayIso, facts.saleDate);
  if (daysLeft < 0) return { open: false, daysLeft, message: `Sale date ${facts.saleDate} has passed; redemption rights generally ended at disposition.` };
  return { open: true, daysLeft, message: `${daysLeft} day(s) remain before the scheduled ${facts.saleDate} disposition to redeem or reinstate.` };
}

export function demandResponseDue(sentIso: string): string {
  return addDaysIso(sentIso, 30);
}
