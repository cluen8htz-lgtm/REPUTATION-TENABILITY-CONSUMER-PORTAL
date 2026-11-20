import { describe, expect, it } from "vitest";
import {
  EMPTY_FACTS, StatementFactsSchema, addBusinessDaysIso, buildDisputeLetterTemplate, classifyResponseHeuristic,
  complianceScore, deadlineStatus, disputeDeadlines, evaluateStatement, exhibitLabel,
} from "../../contracts/fcba-engine";
import { CUEVAS_AUGUST } from "./fixtures";

const ids = (facts: typeof EMPTY_FACTS) => evaluateStatement(facts).map((hit) => hit.ruleId);

describe("evaluateStatement", () => {
  it("finds nothing on a clean statement", () => {
    expect(evaluateStatement(EMPTY_FACTS)).toEqual([]);
    expect(complianceScore([])).toBe(100);
  });

  it("reproduces the Cuevas Exhibit A violation pattern", () => {
    const found = ids(CUEVAS_AUGUST);
    expect(found).toEqual(expect.arrayContaining(["FCBA-001", "FCBA-002", "FCBA-003", "FCBA-004", "FCBA-005", "FCBA-006", "FCBA-013"]));
    expect(found).not.toContain("FCBA-007"); // 28 days between close and due date
    expect(complianceScore(evaluateStatement(CUEVAS_AUGUST))).toBe(0);
  });

  it("only fires FCBA-005 when a mandatory disclosure fails", () => {
    expect(ids({ ...EMPTY_FACTS, statementDate: "2025-08-05", dueDate: "2025-08-20" })).toEqual(["FCBA-007"]);
  });

  it("flags interest that is arithmetically impossible (Exhibit J)", () => {
    const hits = evaluateStatement({ ...EMPTY_FACTS, ytdInterest: 731.95, disclosedBalanceForInterest: 69, apr: 26.74 });
    expect(hits.map((h) => h.ruleId)).toEqual(["FCBA-012"]);
    expect(hits[0].excerpt).toContain("$18.45");
  });

  it("flags impossible Metro-2 coding on a tradeline", () => {
    const found = ids({ ...EMPTY_FACTS, tradeline: { reportsCurrent: true, pastDueAmount: 0, lateRatingSameMonth: true, lateMarkerFromDefectiveStatement: true } });
    expect(found).toEqual(["FCBA-010", "FCBA-011"]);
  });

  it("never fires on unknown facts", () => {
    expect(ids({ ...EMPTY_FACTS, priorStatementCompliant: null, previousBalance: 500 })).toEqual([]);
  });

  it("accepts the empty facts as schema-valid", () => {
    expect(StatementFactsSchema.parse(EMPTY_FACTS)).toEqual(EMPTY_FACTS);
  });
});

describe("exhibit labels", () => {
  it("counts like spreadsheet columns", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701].map(exhibitLabel)).toEqual([
      "Exhibit A", "Exhibit B", "Exhibit Z", "Exhibit AA", "Exhibit AB", "Exhibit AZ", "Exhibit BA", "Exhibit ZZ",
    ]);
  });
});

describe("deadlines", () => {
  it("matches the Cuevas Exhibit C deadline math", () => {
    expect(disputeDeadlines("2025-12-01")).toEqual({ acknowledgeBy: "2025-12-31", resolveBy: "2026-03-01", preArbitrationCureBy: "2025-12-31" });
  });
  it("classifies urgency", () => {
    expect(deadlineStatus("2026-01-10", "2026-01-12")).toBe("overdue");
    expect(deadlineStatus("2026-01-15", "2026-01-12")).toBe("due_soon");
    expect(deadlineStatus("2026-02-15", "2026-01-12")).toBe("open");
    expect(deadlineStatus("2026-01-10", "2026-01-12", true)).toBe("met");
    expect(deadlineStatus(null, "2026-01-12")).toBeNull();
  });
  it("skips weekends for business days", () => {
    expect(addBusinessDaysIso("2025-12-05", 7)).toBe("2025-12-16"); // Fri + 7 business days
  });
});

describe("classifyResponseHeuristic", () => {
  it("spots Chase-style boilerplate", () => {
    const text = "Thank you for contacting us. Enclosed are copies of your account statements. Please complete the enclosed form and return it so we can review your credit report.";
    expect(classifyResponseHeuristic(text).classification).toBe("boilerplate");
  });
  it("recognizes a correction as substantive", () => {
    expect(classifyResponseHeuristic("We reviewed the billing error you identified and credited $8,000.00 to the account on 01/05/2026. Corrected statements are enclosed.").classification).toBe("substantive");
  });
  it("treats empty correspondence as nonresponse", () => {
    expect(classifyResponseHeuristic("").classification).toBe("nonresponse");
  });
});

describe("buildDisputeLetterTemplate", () => {
  it("itemizes each rule once and includes deadlines", () => {
    const hits = evaluateStatement(CUEVAS_AUGUST);
    const letter = buildDisputeLetterTemplate({
      noticeType: "billing_error", consumerName: "Client", creditorName: "Card Issuer", accountLast4: "6109", todayIso: "2025-11-18",
      exhibits: [{ label: "Exhibit A", fileName: "aug.pdf", cycle: "07/15/25-08/05/25" }],
      violations: [...hits, ...hits].map((h) => ({ ...h, exhibit: "Exhibit A" })),
      creditorReceivedIso: "2025-12-01",
    });
    expect(letter.match(/\[FCBA-001\]/g)).toHaveLength(1);
    expect(letter).toContain("2025-12-31");
    expect(letter).toContain("attorney review");
  });
});
