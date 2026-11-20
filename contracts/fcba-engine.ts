/**
 * fcba-engine.ts — deterministic FCBA/TILA screening engine.
 *
 * Pure functions only (no I/O) so the same logic runs on the server, in the
 * browser for live previews, and in unit tests. AI is used solely to *extract*
 * StatementFacts from a document; whether a rule fires is decided here, in
 * code that can be audited line by line against contracts/fcba.ts.
 *
 * Output is screening work product for attorney review — not legal advice.
 */
import { z } from "zod";
import { FCBA_DEADLINES, FCBA_RULES, type FcbaRule } from "./fcba";

export type Severity = "critical" | "major" | "minor";

const money = z.number().finite().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

/** Facts extracted from (or entered for) one periodic statement. */
export const StatementFactsSchema = z.object({
  isFirstStatement: z.boolean().describe("True if this is the first periodic statement after the account opened"),
  statementDate: isoDate.describe("Closing date of the billing cycle, YYYY-MM-DD"),
  dueDate: isoDate.describe("Payment due date, YYYY-MM-DD"),
  creditLimit: money.describe("Credit limit shown on the statement"),
  previousBalance: money.describe("Previous / beginning balance"),
  newBalance: money.describe("New / ending balance"),
  creditsTotal: z.number().finite().describe("Total of the 'Credits' line; 0 if shown as $0.00 or absent"),
  paymentsCreditsNet: money.describe("Value of a combined 'Payments, Credits' summary line, if one is shown"),
  hasItemizedCredits: z.boolean().describe("True if each credit is itemized by amount and posting date"),
  hasCreditLineItem: z.boolean().describe("True if a transaction line discloses the origination extension of credit (identification, amount, date)"),
  originationCreditClaimed: money.describe("Amount of the origination credit extension the consumer asserts, if any"),
  hasCreditDebitDesignation: z.boolean().describe("True if balances are designated as credit or debit balances"),
  balanceComputationDisclosed: z.boolean().describe("True if the statement discloses how the finance-charge balance was computed, including whether credits were deducted"),
  priorStatementCompliant: z.boolean().nullable().describe("Whether the previous statement was compliant; null if unknown or this is the first"),
  apr: z.number().finite().nullable().describe("Purchase APR as a percentage, e.g. 26.74"),
  ytdInterest: money.describe("Total interest charged year-to-date"),
  ytdFees: money.describe("Total fees charged year-to-date"),
  disclosedBalanceForInterest: money.describe("Balance subject to interest rate as disclosed"),
  creditBalanceAsserted: money.describe("Credit balance in the consumer's favor, if asserted"),
  creditBalanceRefunded: z.boolean().describe("True if any asserted credit balance was applied or refunded"),
  documentsRequested: z.boolean().describe("True if the consumer has requested documentary evidence of the credit extension"),
  creditorProducedDocuments: z.boolean().describe("True if the creditor produced the requested documentary evidence"),
  tradeline: z
    .object({
      reportsCurrent: z.boolean(),
      pastDueAmount: money,
      lateRatingSameMonth: z.boolean(),
      lateMarkerFromDefectiveStatement: z.boolean(),
    })
    .nullable()
    .describe("Credit-report tradeline facts, only for credit report exhibits"),
});
export type StatementFacts = z.infer<typeof StatementFactsSchema>;

export const EMPTY_FACTS: StatementFacts = {
  isFirstStatement: false,
  statementDate: null,
  dueDate: null,
  creditLimit: null,
  previousBalance: null,
  newBalance: null,
  creditsTotal: 0,
  paymentsCreditsNet: null,
  hasItemizedCredits: true,
  hasCreditLineItem: true,
  originationCreditClaimed: null,
  hasCreditDebitDesignation: true,
  balanceComputationDisclosed: true,
  priorStatementCompliant: null,
  apr: null,
  ytdInterest: null,
  ytdFees: null,
  disclosedBalanceForInterest: null,
  creditBalanceAsserted: null,
  creditBalanceRefunded: false,
  documentsRequested: false,
  creditorProducedDocuments: false,
  tradeline: null,
};

export type RuleHit = {
  ruleId: FcbaRule["id"];
  title: string;
  statute: string;
  severity: Severity;
  excerpt: string;
  annotation: string;
  mark: FcbaRule["mark"];
  markTarget: FcbaRule["markTarget"];
};

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const to = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((to - from) / 86_400_000);
}

/** Maximum annual interest on a balance at an APR (simple, conservative upper bound). */
export function maxAnnualInterest(balance: number, apr: number): number {
  return Math.round(balance * (apr / 100) * 100) / 100;
}

/**
 * Evaluate every FCBA rule against one statement's facts.
 * Rules only fire on affirmative evidence; unknown (null) facts never fire.
 */
export function evaluateStatement(facts: StatementFacts): RuleHit[] {
  const hits: RuleHit[] = [];
  const fire = (id: FcbaRule["id"], severity: Severity, excerpt: string) => {
    const rule = FCBA_RULES.find((item) => item.id === id)!;
    hits.push({ ruleId: id, title: rule.title, statute: rule.statute, severity, excerpt, annotation: rule.annotation, mark: rule.mark, markTarget: rule.markTarget });
  };
  const origination = facts.originationCreditClaimed ?? 0;

  if (facts.isFirstStatement && facts.creditLimit && !facts.hasCreditLineItem) {
    fire("FCBA-001", "critical", `Credit limit ${usd(facts.creditLimit)} shown with no transaction line disclosing the extension of credit by amount, date, and identification.`);
  }
  if (origination > 0 && facts.creditsTotal === 0) {
    fire("FCBA-002", "critical", `Statement reports Credits: ${usd(0)} although a ${usd(origination)} origination credit is asserted.`);
  }
  if (origination > 0 && !facts.balanceComputationDisclosed) {
    fire("FCBA-003", "critical", "No disclosure that the finance-charge balance was determined without deducting credits, and no disclosure of the amount of those credits.");
  }
  if ((facts.priorStatementCompliant === false && facts.previousBalance !== null) || (!facts.hasCreditDebitDesignation && facts.newBalance !== null)) {
    const parts = [];
    if (facts.priorStatementCompliant === false && facts.previousBalance !== null) parts.push(`beginning balance ${usd(facts.previousBalance)} carried forward from a non-compliant prior statement`);
    if (!facts.hasCreditDebitDesignation && facts.newBalance !== null) parts.push(`new balance ${usd(facts.newBalance)} shown with no credit/debit designation`);
    fire("FCBA-004", "major", `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()));
  }
  if (facts.paymentsCreditsNet !== null && !facts.hasItemizedCredits) {
    fire("FCBA-006", "major", `'Payments, Credits' reported as a single unitemized net of ${usd(facts.paymentsCreditsNet)}.`);
  }
  if (facts.statementDate && facts.dueDate) {
    const days = daysBetween(facts.statementDate, facts.dueDate);
    if (days >= 0 && days < 21) fire("FCBA-007", "major", `Only ${days} days between the statement closing date (${facts.statementDate}) and the due date (${facts.dueDate}); at least 21 are required.`);
  }
  if (facts.priorStatementCompliant === false) {
    fire("FCBA-008", "major", "This statement inherits its beginning balance from a defective prior statement — each successive statement is an independent violation.");
  }
  if (facts.creditBalanceAsserted !== null && facts.creditBalanceAsserted > 1 && !facts.creditBalanceRefunded) {
    fire("FCBA-009", "critical", `Credit balance of ${usd(facts.creditBalanceAsserted)} asserted and not applied or refunded.`);
  }
  if (facts.tradeline) {
    const t = facts.tradeline;
    if (t.reportsCurrent && (t.pastDueAmount ?? 0) === 0 && t.lateRatingSameMonth) {
      fire("FCBA-010", "critical", "Tradeline reports Current with $0.00 past due while also reporting a late rating for the same month.");
    }
    if (t.lateMarkerFromDefectiveStatement) {
      fire("FCBA-011", "critical", "Late-payment marker derives from a delinquency computed on a non-compliant periodic statement.");
    }
  }
  if (facts.ytdInterest !== null && facts.disclosedBalanceForInterest !== null && facts.apr) {
    const max = maxAnnualInterest(facts.disclosedBalanceForInterest, facts.apr);
    if (facts.ytdInterest > max * 2 && facts.ytdInterest - max > 5) {
      fire("FCBA-012", "critical", `Year-to-date interest ${usd(facts.ytdInterest)} exceeds the maximum of about ${usd(max)} a full year of interest could produce on the disclosed ${usd(facts.disclosedBalanceForInterest)} balance at ${facts.apr}% APR.`);
    }
  }
  if (facts.documentsRequested && !facts.creditorProducedDocuments) {
    fire("FCBA-013", "major", "Documentary evidence of the extension of credit was requested and has not been produced.");
  }

  // FCBA-005 is derivative: a statement missing §1637(b) mandatory disclosures.
  const disclosureFailures = hits.filter((hit) => ["FCBA-001", "FCBA-002", "FCBA-003", "FCBA-004", "FCBA-006"].includes(hit.ruleId));
  if (disclosureFailures.length > 0) {
    fire("FCBA-005", "critical", `Statement omits ${disclosureFailures.length} mandatory disclosure(s) (${disclosureFailures.map((hit) => hit.ruleId).join(", ")}) and may be treated as not validly transmitted.`);
  }
  const order = FCBA_RULES.map((rule) => rule.id as string);
  return hits.sort((a, b) => order.indexOf(a.ruleId) - order.indexOf(b.ruleId));
}

/** 0–100; 100 = no screening issues found. */
export function complianceScore(hits: Pick<RuleHit, "severity">[]): number {
  const penalty = hits.reduce((total, hit) => total + (hit.severity === "critical" ? 22 : hit.severity === "major" ? 10 : 4), 0);
  return Math.max(0, 100 - penalty);
}

/** Spreadsheet-style exhibit labels: A … Z, AA, AB … (the codebook's "A1" scheme collided). */
export function exhibitLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return `Exhibit ${label}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Business days (Mon–Fri; federal holidays not modeled — verify with counsel). */
export function addBusinessDaysIso(iso: string, days: number): string {
  let current = iso;
  let added = 0;
  while (added < days) {
    current = addDaysIso(current, 1);
    const dow = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return current;
}

export type DeadlineStatus = "overdue" | "due_soon" | "open" | "met";

export function deadlineStatus(dueIso: string | null | undefined, todayIso: string, met = false): DeadlineStatus | null {
  if (!dueIso) return null;
  if (met) return "met";
  const days = daysBetween(todayIso, dueIso.slice(0, 10));
  if (days < 0) return "overdue";
  if (days <= 7) return "due_soon";
  return "open";
}

/** §1666(a) clocks run from the creditor's receipt of the billing-error notice. */
export function disputeDeadlines(creditorReceivedIso: string) {
  return {
    acknowledgeBy: addDaysIso(creditorReceivedIso, FCBA_DEADLINES.acknowledgeDays),
    resolveBy: addDaysIso(creditorReceivedIso, FCBA_DEADLINES.resolveMaxDays),
    preArbitrationCureBy: addDaysIso(creditorReceivedIso, FCBA_DEADLINES.preArbCureDays),
  };
}

/** 60-day window to send a billing-error notice, measured from statement transmittal. */
export function disputeWindowCloses(statementIso: string): string {
  return addDaysIso(statementIso, FCBA_DEADLINES.disputeWindowDays);
}

export type ResponseClass = "substantive" | "boilerplate" | "nonresponse";

/**
 * Heuristic creditor-response classifier used when AI is unavailable, and as a
 * sanity check on AI output. Substantive responses engage with specific amounts,
 * dates, or a written explanation; boilerplate ones enclose copies or forms.
 */
export function classifyResponseHeuristic(text: string): { classification: ResponseClass; signals: string[] } {
  const body = text.replace(/\s+/g, " ").trim();
  if (body.length < 40) return { classification: "nonresponse", signals: ["no meaningful text"] };
  const signals: string[] = [];
  const boilerplatePatterns: Array<[RegExp, string]> = [
    [/enclosed (are )?(copies|a copy) of (your )?(account )?statements?/i, "encloses statement copies"],
    [/please (complete|fill out|sign) (and return )?the (enclosed|attached) (form|affidavit)/i, "requests a form"],
    [/(we|our records) (have )?(verified|show|indicate) (that )?(the|your) (account|balance) (is|was) (accurate|correct|reported correctly)/i, "conclusory 'verified' statement"],
    [/thank you for (contacting|your (letter|inquiry))/i, "form salutation"],
    [/unable to (locate|identify) (a|any|the) (billing )?error/i, "no-error conclusion without explanation"],
  ];
  const substantivePatterns: Array<[RegExp, string]> = [
    [/\$\s?\d[\d,]*\.\d{2}/, "cites specific amounts"],
    [/(corrected|adjusted|reversed|credited|refunded)/i, "reports a correction"],
    [/(explanation|reason(s)?) (for|why)/i, "provides an explanation"],
    [/(1666|1026\.13|billing error)/i, "engages the billing-error statute"],
  ];
  let boiler = 0;
  let substantive = 0;
  for (const [re, label] of boilerplatePatterns) if (re.test(body)) { boiler++; signals.push(label); }
  for (const [re, label] of substantivePatterns) if (re.test(body)) { substantive++; signals.push(label); }
  const corrected = /(corrected|adjusted|reversed|credited|refunded)/i.test(body);
  if (corrected || substantive >= 2 && boiler <= 1) return { classification: "substantive", signals };
  if (boiler >= 1) return { classification: "boilerplate", signals };
  return { classification: substantive >= 1 ? "substantive" : "boilerplate", signals };
}

export type LetterInput = {
  noticeType: "billing_error" | "noncompliance_notice" | "arbitration_demand";
  consumerName: string;
  creditorName: string;
  accountLast4: string;
  todayIso: string;
  exhibits: Array<{ label: string; fileName: string; cycle?: string | null }>;
  violations: Array<{ ruleId: string; title: string; statute: string; excerpt: string; exhibit?: string | null }>;
  creditorReceivedIso?: string | null;
};

/** Deterministic, citation-safe letter used when AI drafting is unavailable. */
export function buildDisputeLetterTemplate(input: LetterInput): string {
  const heading = {
    billing_error: "NOTICE OF BILLING ERROR — 15 U.S.C. §1666; 12 C.F.R. §1026.13",
    noncompliance_notice: "NOTICE OF FCBA NON-COMPLIANCE — 15 U.S.C. §1666(a)",
    arbitration_demand: "PRE-ARBITRATION NOTICE AND DEMAND",
  }[input.noticeType];
  const unique = new Map<string, LetterInput["violations"][number][]>();
  for (const v of input.violations) unique.set(v.ruleId, [...(unique.get(v.ruleId) ?? []), v]);
  const items = [...unique.entries()].map(([ruleId, list], index) => {
    const first = list[0];
    const where = list.map((v) => v.exhibit).filter(Boolean).join(", ");
    return `${index + 1}. ${first.title} [${ruleId}]\n   Authority: ${first.statute}\n   ${first.excerpt}${where ? `\n   See: ${where}` : ""}`;
  });
  const deadlines = input.creditorReceivedIso ? disputeDeadlines(input.creditorReceivedIso) : null;
  return [
    input.todayIso,
    "",
    `VIA CERTIFIED MAIL — RETURN RECEIPT REQUESTED`,
    "",
    input.creditorName,
    "Attn: Billing Inquiries / Legal Department",
    "",
    `Re: Account ending ${input.accountLast4}`,
    `Cardholder: ${input.consumerName}`,
    "",
    heading,
    "",
    "To Whom It May Concern:",
    "",
    "I am writing to dispute billing errors on the account referenced above. The specific errors, the amount and type of each, and the reasons I believe each is an error are itemized below.",
    "",
    "ITEMIZED BILLING ERRORS",
    "",
    ...(items.length ? items : ["(No screening findings are on file. Itemize each disputed amount, date, and reason here before sending.)"]),
    "",
    "REQUEST FOR DOCUMENTARY EVIDENCE",
    "",
    "Under 12 C.F.R. §1026.13(a)(6) and (f)(2), I request copies of documentary evidence supporting the balance, including the signed credit document, the ledger entries for each credit and debit, and the computation worksheets used to calculate each finance charge.",
    "",
    "RELIEF REQUESTED",
    "",
    "Please (1) correct the account and reissue corrected statements; (2) recalculate finance charges and fees; (3) refrain from collecting the disputed amounts or reporting them as delinquent while this dispute is pending, as 15 U.S.C. §1666a requires; and (4) provide a written explanation of your determination.",
    "",
    "RESPONSE DEADLINES",
    "",
    deadlines
      ? `You must acknowledge this notice in writing by ${deadlines.acknowledgeBy} (30 days) and resolve it no later than ${deadlines.resolveBy} (two complete billing cycles, not more than 90 days). 15 U.S.C. §1666(a).`
      : "You must acknowledge this notice in writing within 30 days of receipt and resolve it within two complete billing cycles (not more than 90 days). 15 U.S.C. §1666(a).",
    "",
    "ENCLOSED EXHIBITS",
    "",
    ...(input.exhibits.length ? input.exhibits.map((e) => `- ${e.label}: ${e.fileName}${e.cycle ? ` (cycle ${e.cycle})` : ""}`) : ["- (none listed)"]),
    "",
    "Please preserve all records relating to this account, including call recordings and internal notes.",
    "",
    "Sincerely,",
    "",
    "",
    input.consumerName,
    "",
    "— Draft prepared for attorney review. Not legal advice. Verify every fact, date, and citation before sending. —",
  ].join("\n");
}
