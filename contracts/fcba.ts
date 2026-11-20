/**
 * fcba.ts — Fair Credit Billing Act violation-detection rules.
 *
 * Encoded from the Cuevas v. Chase Bank USA complaint blueprint
 * (FCBA_TILA_Cuevas_Complaint_FINAL + Exhibits A–L). Each rule maps a
 * detectable statement condition to the statute, the annotation rendered
 * on the regenerated statement, and the dispute language used in the
 * auto-generated §1666 notice.
 *
 * Red-triangle marks: every rule with `mark: "triangle"` renders a red
 * triangle around the target field on the annotated statement.
 */

export const FCBA_RULES = [
  {
    id: "FCBA-001",
    title: "Failure to disclose nonsale credit extension",
    statute: "15 U.S.C. §1637(b)(2); 12 C.F.R. §1026.8(b); 12 C.F.R. §1026.7(b)(2)",
    condition:
      "First periodic statement shows a Credit Limit but no line item disclosing the origination extension of credit (brief identification, amount, date).",
    mark: "triangle",
    markTarget: "creditLimit",
    annotation:
      "⚠ RED TRIANGLE — CREDIT LIMIT IS A CEILING, NOT A TRANSACTION. The origination extension of credit (nonsale credit, 12 C.F.R. §1026.8(b)) was never disclosed by amount, date, and brief identification as required by 15 U.S.C. §1637(b)(2). See Comment 8(b)-1, 8(b)-4.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-002",
    title: "False 'Credits: $0.00' reporting",
    statute: "15 U.S.C. §1637(b)(3); 15 U.S.C. §1666(b)(4)",
    condition:
      "Statement reports Credits of $0.00 while an origination credit extension exists.",
    mark: "bracket",
    markTarget: "creditsLine",
    annotation:
      "Reported $0.00 credits instead of the required origination credit — misrepresentation of total credits (§1637(b)(3)) and failure to properly reflect a credit issued to the obligor (§1666(b)(4)).",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-003",
    title: "Balance computed without deducting credits — undisclosed",
    statute: "15 U.S.C. §1637(b)(7); 12 C.F.R. §1026.7(b)(5)",
    condition:
      "Finance-charge balance determined without deducting all credits, with no disclosure of that fact or the amount of the credits.",
    mark: "bracket",
    markTarget: "interestCharges",
    annotation:
      "Improper balance calculation — balance determined without first deducting all credits; the fact and the amount of the credits were not disclosed. §1637(b)(7).",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-004",
    title: "Inflated beginning/ending balances; no credit/debit designation",
    statute: "15 U.S.C. §1637(b)(1), (b)(8); Comments 7(b)(1)-1, 7(b)(10)-1",
    condition:
      "Opening balance carried forward from a prior non-compliant ending balance, or bare figures with no credit/debit designation.",
    mark: "bracket",
    markTarget: "newBalance",
    annotation:
      "Outstanding balance overstated by the undisclosed credit; bare figures fail to designate credit vs. debit balance as required by Official Staff Commentary 7(b)(1)-1 and 7(b)(10)-1.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-005",
    title: "Non-compliant statement = 'no statement' at all",
    statute: "15 U.S.C. §1666(b)(6); 15 U.S.C. §1666b; Saunders v. Ameritrust",
    condition:
      "Statement fails §1637(b) mandatory disclosures; treated as constructively not transmitted.",
    mark: "wholePage",
    markTarget: "statement",
    annotation:
      "Non-compliant first periodic statement = NO valid statement (15 U.S.C. §1666(b)(6)). Cannot support billing, delinquency, finance charges, or credit reporting. §1666b not satisfied.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-006",
    title: "Unitemized payments/credits net",
    statute: "12 C.F.R. §1026.7(b)(3)",
    condition:
      "'Payments, Credits' appears as a single net with no credit disclosed by amount and date of crediting.",
    mark: "bracket",
    markTarget: "paymentsCredits",
    annotation:
      "Unitemized net violates 12 C.F.R. §1026.7(b)(3) — each credit must be disclosed by amount and date of crediting.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-007",
    title: "§1666b timing violation",
    statute: "15 U.S.C. §1666b",
    condition:
      "Statement not mailed/delivered at least 21 days before payment due date, OR statement non-compliant (timely mailing alone insufficient).",
    mark: "bracket",
    markTarget: "dueDate",
    annotation:
      "Statement not provided on time / not in compliance with 15 U.S.C. §1666b — a statement must be BOTH timely AND compliant. Please remove late fees and delinquency designations derived from this cycle.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-008",
    title: "Carry-forward of defective balances (continuing violation)",
    statute: "15 U.S.C. §1666(b)(5)-(6); Krieger v. Bank of America, 890 F.3d 429 (3d Cir. 2018)",
    condition:
      "Each subsequent statement inherits an incorrect beginning balance from a prior non-compliant statement.",
    mark: "bracket",
    markTarget: "previousBalance",
    annotation:
      "Beginning balance carried forward from a defective prior statement — each successive statement is an independent violation (Krieger; Comment 13(b)(1)-2). New 60-day dispute window runs from each statement.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-009",
    title: "Failure to apply/refund credit balance",
    statute: "15 U.S.C. §1666d; 12 C.F.R. §1026.11; White v. Chase Bank",
    condition:
      "Credit balance in excess of $1 exists (or is asserted) and was not credited to the account or refunded within 7 business days of written request.",
    mark: "triangle",
    markTarget: "accountSummary",
    annotation:
      "Credit balance in the consumer's favor was not applied or refunded — violation of 15 U.S.C. §1666d and the Cardmember Agreement Credit Balances clause.",
    exhibitCategory: "Credit Reports & Balances",
  },
  {
    id: "FCBA-010",
    title: "Facially impossible Metro-2 tradeline coding",
    statute: "15 U.S.C. §1681s-2(b)(1); FCRA accuracy standard",
    condition:
      "Tradeline simultaneously reports Current/Pays As Agreed, $0 past due, and a 30/60/90 late rating for the same month.",
    mark: "triangle",
    markTarget: "tradeline",
    annotation:
      "Internally inconsistent Metro-2 coding: an account cannot simultaneously be Current with $0 past due and 30 days delinquent. Inaccurate as a matter of law; unverifiable under §1681s-2(b).",
    exhibitCategory: "Credit Reports & Balances",
  },
  {
    id: "FCBA-011",
    title: "Late markers derived from defective statements",
    statute: "15 U.S.C. §1666b; §1681s-2(b); §1681i",
    condition:
      "Any 30/60/90-day late marker whose delinquency was computed from a non-compliant periodic statement.",
    mark: "triangle",
    markTarget: "paymentHistory",
    annotation:
      "Delinquency derived from a §1637(b)-defective statement is legally impossible — invalid due date and minimum payment ab initio. Remove the late marker and any 'Potentially Negative' label.",
    exhibitCategory: "Credit Reports & Balances",
  },
  {
    id: "FCBA-012",
    title: "Finance-charge arithmetic impossibility",
    statute: "15 U.S.C. §1637(b)(7); Cardmember Agreement daily-balance clause",
    condition:
      "Interest charged exceeds the maximum lawful charge on the disclosed balance at the disclosed APR (e.g., $731.95 YTD vs ≈$18.44 max on $69 at 26.74%).",
    mark: "bracket",
    markTarget: "ytdTotals",
    annotation:
      "Year-to-date interest is arithmetically irreconcilable with the disclosed balance and APR — self-executing proof the finance-charge balance was drawn from an inflated, credit-omitting ledger. Produce computation worksheets.",
    exhibitCategory: "Periodic Statements",
  },
  {
    id: "FCBA-013",
    title: "Refusal to produce signed credit document / documentary evidence",
    statute: "12 C.F.R. §1026.13(a)(6), (f)(2); Widjaja v. JPMorgan, 21 F.4th 579 (9th Cir. 2021)",
    condition:
      "Creditor fails to furnish copies of documentary evidence of the extension of credit after a billing-error notice requesting clarification.",
    mark: "note",
    markTarget: "correspondence",
    annotation:
      "Request for clarification + documentary evidence (signed credit document, receipt, ledger entries, computation worksheets) is a §1026.13(a)(6) billing error. Creditor bears the burden of proving compliance (Widjaja).",
    exhibitCategory: "Correspondence & Disputes",
  },
] as const;

export type FcbaRule = (typeof FCBA_RULES)[number];

/** Exhibit categories — every uploaded artifact lands in one of these. */
export const EXHIBIT_CATEGORIES = [
  { value: "statements", label: "Periodic Statements", folder: "Exhibits - Periodic Statements" },
  { value: "credit_reports", label: "Credit Reports & Balances", folder: "Exhibits - Credit Reports" },
  { value: "disputes", label: "Disputes & Correspondence", folder: "Exhibits - Disputes & Notices" },
  { value: "agreement", label: "Cardmember Agreement / Credit Documents", folder: "Exhibits - Credit Documents" },
  { value: "tracking", label: "Proof of Mailing / Tracking", folder: "Exhibits - Proof of Service" },
  { value: "scores", label: "Score Reports & Damages", folder: "Exhibits - Damages & Scores" },
  { value: "responses", label: "Creditor Responses", folder: "Exhibits - Creditor Responses" },
] as const;

/** FCBA procedural deadlines, in days from creditor receipt of notice. */
export const FCBA_DEADLINES = {
  acknowledgeDays: 30,       // 15 U.S.C. §1666(a)(1)
  resolveMaxDays: 90,          // §1666(a)(3): two complete billing cycles, max 90
  disputeWindowDays: 60,     // §1666(a); restarts per statement per Comment 13(b)(1)-2 / Krieger
  creditBalanceRefundDays: 7, // §1666d / 12 C.F.R. §1026.11
  preArbCureDays: 30,        // per Cardmember Agreement pre-arbitration notice
} as const;

export type ViolationHit = {
  ruleId: string;
  statementDocumentId: number;
  page: number | null;
  field: string | null;
  severity: "critical" | "major" | "minor";
  excerpt: string;
};

export type AnnotatedStatement = {
  documentId: number;
  exhibitLabel: string; // auto-assigned: "Exhibit A", "Exhibit B", ...
  cycle: string; // e.g. "07/15/25–08/05/25"
  hits: ViolationHit[];
  annotatedFileKey: string; // regenerated PDF w/ red triangles + brackets
  complianceScore: number; // 0-100
};
