/**
 * repo.ts — Self-Help Repossession violation engine (Florida + California).
 *
 * Encoded from the Toyota Motor Credit securitization breakdown blueprint:
 * the retail installment contract (RC) was securitized — Toyota Motor Credit
 * sold the paper into a trust (e.g., TMVT / "trust ventures"), so the named
 * creditor on the notices may hold NO security interest while the DMV title
 * still shows the old lienholder. The agent treats this as the core
 * misrepresentation pattern and verifies it against SEC filings.
 */

export const UCC_SELF_HELP = {
  "9-609": "Secured party's right to take possession after default — without breach of the peace (self-help), or by judicial process.",
  "9-610": "Disposition of collateral must be conducted in every aspect commercially reasonable.",
  "9-611": "Notification before disposition: every debtor, secondary obligor, and (for consumer goods) all subordinate secured parties must be notified.",
  "9-613": "Contents & form of notification: contents differ if secured party has sold accounts — must identify the SECURED PARTY and describe method of sale.",
  "9-615": "Application of proceeds; debtor's surplus / deficiency obligations.",
  "9-616": "Explanation of calculation of surplus or deficiency (consumer-goods transactions, on request).",
  "9-620": "Acceptance of collateral in full/partial satisfaction (strict foreclosure).",
  "9-621": "Notification of proposal to accept collateral.",
  "9-622": "Effect of acceptance — discharges the obligation to the extent of the collateral's value.",
  "9-623": "Right to redeem collateral — tender fulfillment of all obligations plus expenses; only a debtor/secondary obligor may redeem.",
} as const;

export const STATE_SELF_HELP = {
  FL: {
    citation: "Fla. Stat. §679.609",
    text: "A secured party, after default, may take possession of the collateral by any method permitted by law, including without breach of the peace under §679.609(2)(b) self-help, or proceed by action under §679.609(1).",
    companions: ["§679.610 (commercially reasonable disposition)", "§679.611 (notification)", "§679.613 (contents/form)", "§679.616 (explanation)", "§679.623 (redemption)"],
  },
  CA: {
    citation: "Cal. Com. Code §9609",
    text: "California analogue: secured party may take possession after default without breach of the peace; §9610 commercially reasonable; §9613 notice contents; §9623 redemption.",
  },
} as const;

export const FDCPA_REPO = {
  "1692f(6)": "15 U.S.C. §1692f(6): taking or threatening to take nonjudicial action to effect dispossession or disablement of property if there is NO present right to possession — the property may NOT be taken, or the debtor may not be deprived of it, without a present right to possession.",
  repoAgentCoverage: "Repossession agents and forwarders who acquired the debt after default are 'debt collectors' under §1692a(6); their conduct is actionable.",
} as const;

/** Case-law anchors (upload the full PACER files into the agent before running analysis). */
export const CASE_ANCHORS = [
  {
    id: "wright-santander",
    name: "Wright v. Santander Consumer USA, Inc.",
    court: "M.D. Fla. (Middle District of Florida)",
    role: "Federal complaint template + wrongful-repossession theory where the plaintiff lacked a present right to possession / secured party failed to comply with Article 9 notice and breach-of-peace requirements.",
    mustUpload: true,
  },
  {
    id: "leal-toyota",
    name: "Leal v. Toyota Motor Credit Corp.",
    court: "California",
    role: "Toyota Motor Credit-specific repossession/securitization authority; embodies the consumer-law and SEC-attorney analytical frame for the TMVT trust structure.",
    mustUpload: true,
  },
] as const;

/**
 * SEC evidence chain the agent must reconstruct (the securitization blueprint):
 * 424B5 prospectus → 10-K → 8-K (contract year) → UCC-1 → Sales & Servicing
 * Agreement (obtainable via the trust's tender offer / SEC EDGAR) → exact
 * date/time the RC was signed vs. date the receivable was sold to the trust.
 */
export const SEC_EVIDENCE_CHAIN = [
  { doc: "424B5 Prospectus (shelf/term)", source: "SEC EDGAR — trust filing (e.g., TMVT Toyota Auto Receivables)", use: "Proves receivables sold into trust; identifies trust as owner; list of exhibits (sale & servicing agreements)." },
  { doc: "10-K (contract year)", source: "SEC EDGAR — servicer/registrant", use: "Confirms securitization treatment, sale-of-receivables accounting, trust structure." },
  { doc: "8-K (contract year)", source: "SEC EDGAR", use: "Closing/issuance date of the trust's note offering around the RC signing date — fixes WHEN the security interest moved." },
  { doc: "UCC-1 financing statements", source: "State DMV/UCC filing office (FL/CA)", use: "Who is the secured party of record at repossession date vs. who sent the §9-611 notices." },
  { doc: "Sale & Servicing Agreement", source: "SEC EDGAR exhibit to 424B5, or tender offer copies; cost check required", use: "True sale cutoff, representations, servicing transfer — proves whether the named creditor retained ANY security interest." },
  { doc: "Tender offer copies / RC timestamp", source: "Trust's tender-offer materials; dealer DMS e-contract timestamp", use: "Exact date/time the retail contract was signed relative to the receivable sale date." },
] as const;

export const REPO_RULES = [
  { id: "REPO-001", title: "No present right to possession — wrongful repossession", statute: "UCC 9-609; Fla. Stat. §679.609; 15 U.S.C. §1692f(6); Wright v. Santander (M.D. Fla.)",
    condition: "Entity ordering/taking the vehicle is not the secured party of record (paper sold to trust; DMV lien stale).",
    annotation: "Repossession without a present right to possession violates §1692f(6) and Article 9; the entity presented itself as creditor/secured party but had sold its interest." },
  { id: "REPO-002", title: "Failure to disclose true secured party on §9-613 notice", statute: "UCC 9-613; Fla. Stat. §679.613",
    condition: "Notice omits or misstates the secured party (trust/TMVT not disclosed; original finance company still named).",
    annotation: "When receivables are sold, §9-613 requires identifying the secured party — concealment of the trust sale is a material misrepresentation." },
  { id: "REPO-003", title: "No redemption opportunity — time/place/date of sale never given", statute: "UCC 9-611, 9-623; Fla. Stat. §§679.611, 679.623",
    condition: "Debtor never received time, place, and date of the disposition; therefore never had the right to redeem.",
    annotation: "Redemption is extinguished only by a commercially reasonable disposition after compliant notice; without time/place/date the obligor's §9-623 rights were violated." },
  { id: "REPO-004", title: "Disposition not commercially reasonable", statute: "UCC 9-610, 9-615; Fla. Stat. §679.610",
    condition: "Sale not conducted in every aspect commercially reasonable (no notice window, below-market, private sale without method disclosure).",
    annotation: "Non-commercially-reasonable disposition shifts deficiency exposure and supports actual/statutory damages." },
  { id: "REPO-005", title: "Breach of the peace", statute: "UCC 9-609(2)(b); Fla. Stat. §679.609(2)",
    condition: "Repossession accomplished over objection, in a closed garage, or with confrontation.",
    annotation: "Self-help is available ONLY without breach of the peace; any breach makes the taking wrongful." },
  { id: "REPO-006", title: "FDCPA — repossession agency as debt collector", statute: "15 U.S.C. §1692a(6), §1692f(6), §1692d/e",
    condition: "Repo agent/forwarder engaged in collection activity (threats, intimidation, false statements about right to take).",
    annotation: "Repo companies collecting defaulted consumer debt are debt collectors; their misrepresentations and wrongful takings are independently actionable." },
  { id: "REPO-007", title: "Missing/misleading §9-616 deficiency explanation", statute: "UCC 9-616; Fla. Stat. §679.616",
    condition: "Deficiency demanded without the required explanation of calculation, or with inflated figures from a non-commercially-reasonable sale.",
    annotation: "Deficiency claims must be supported; failure to provide the §9-616 explanation undermines the deficiency." },
  { id: "REPO-008", title: "Securitization concealment — securitized paper presented as owned", statute: "UCC 9-613; 15 U.S.C. §1692e (false representation of character/legal status); special-report basis",
    condition: "Prospectus/10-K/8-K show the receivable was sold to the trust, yet the creditor/repo entity claimed ownership/security interest.",
    annotation: "The creditor chose securitization (no retained interest) yet repossessed as if secured — a material misrepresentation of its legal status." },
] as const;

/** Demand-package document checklist the agent sends to the creditor/repo servicer. */
export const DEMAND_CHECKLIST = [
  "Copy of the original retail installment contract (RC) and all amendments",
  "All §9-611 notices (default notice, notice of intent to sell / notice of disposition)",
  "All §9-613 and §9-616 notices with proof of mailing",
  "UCC-1 financing statement(s) of record at repossession date",
  "Time, place, and date of sale, and sale proceeds accounting (§9-615)",
  "Authority documentation: current secured party of record / trust assignment",
  "Sales & Servicing Agreement and receivable sale cutoff schedule",
  "Repo agent's work order, dispatch, and chain-of-authorization",
] as const;
