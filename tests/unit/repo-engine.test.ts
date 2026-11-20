import { describe, expect, it } from "vitest";
import { EMPTY_REPO_FACTS, evaluateRepo, missingEvidence, redemptionWindow, repoRiskScore } from "../../contracts/repo-engine";

describe("evaluateRepo", () => {
  it("is quiet when nothing is known", () => {
    expect(evaluateRepo(EMPTY_REPO_FACTS)).toEqual([]);
  });

  it("builds the securitization pattern from the blueprint", () => {
    const hits = evaluateRepo({
      ...EMPTY_REPO_FACTS,
      repossessionDate: "2026-03-10",
      receivableSoldToTrustDate: "2024-06-01",
      trustName: "Auto Receivables Owner Trust 2024-B",
      noticeSenderName: "Lender Motor Credit Corp.",
      securedPartyOfRecord: "Auto Receivables Owner Trust 2024-B",
      noticeOfSaleReceived: "yes",
      noticeStatesTimePlaceOrMethod: "no",
      deficiencyDemanded: "yes",
    });
    expect(hits.map((h) => h.ruleId)).toEqual(["REPO-001", "REPO-002", "REPO-003", "REPO-007", "REPO-008"]);
    expect(repoRiskScore(hits)).toBe(90);
  });

  it("applies California's 15-day Notice of Intent rule", () => {
    const hits = evaluateRepo({ ...EMPTY_REPO_FACTS, state: "CA", noticeOfSaleReceived: "yes", noticeStatesTimePlaceOrMethod: "yes", noticeDate: "2026-03-01", saleDate: "2026-03-12" });
    expect(hits).toHaveLength(1);
    expect(hits[0].statute).toContain("2983.2");
  });

  it("flags breach of the peace with the state citation", () => {
    const hits = evaluateRepo({ ...EMPTY_REPO_FACTS, breachOfPeace: { ...EMPTY_REPO_FACTS.breachOfPeace, objectedAtScene: true } });
    expect(hits[0].ruleId).toBe("REPO-005");
    expect(hits[0].statute).toContain("679.609");
  });
});

describe("helpers", () => {
  it("lists missing evidence", () => {
    expect(missingEvidence(EMPTY_REPO_FACTS, ["contract"])).not.toContain("Retail installment contract (RC) and amendments");
  });
  it("computes the redemption window", () => {
    expect(redemptionWindow({ ...EMPTY_REPO_FACTS, saleDate: "2026-03-20" }, "2026-03-10").daysLeft).toBe(10);
    expect(redemptionWindow({ ...EMPTY_REPO_FACTS, saleDate: "2026-03-01" }, "2026-03-10").open).toBe(false);
  });
});
