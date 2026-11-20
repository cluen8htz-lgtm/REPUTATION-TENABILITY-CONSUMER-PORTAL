import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { evaluateStatement, complianceScore } from "../../contracts/fcba-engine";
import { annotateStatement, pdfSafe, textToPdf } from "../../api/fcba/annotate";
import { CUEVAS_AUGUST, samplePdf } from "./fixtures";

describe("annotateStatement", () => {
  it("overlays marks on the located fields and appends a violation map", async () => {
    const hits = evaluateStatement(CUEVAS_AUGUST);
    const { pdf, located } = await annotateStatement({
      bytes: await samplePdf(), contentType: "application/pdf", exhibitLabel: "Exhibit A", fileName: "aug.pdf",
      cycle: "07/15/25-08/05/25", hits, complianceScore: complianceScore(hits),
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(located["FCBA-001"]).toBe(1); // credit limit found on page 1
    expect(located["FCBA-002"]).toBe(1); // "Credits" line
    expect(located["FCBA-006"]).toBe(1); // "Payments, Credits"
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    expect(text).toContain("FCBA / TILA VIOLATION MAP");
    expect(text).toContain("Credit Limit"); // original text layer preserved
  });

  it("handles text exhibits", async () => {
    const { pdf } = await annotateStatement({ bytes: new TextEncoder().encode("Statement\nCredit Limit $500"), contentType: "text/plain", exhibitLabel: "Exhibit B", fileName: "s.txt", hits: [], complianceScore: 100 });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it("typesets letters", async () => {
    const pdf = await textToPdf("Letter", "NOTICE OF BILLING ERROR\n\nBody text § 1666 — ok ≈ fine");
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(pdfSafe("≈ 🔺 ok")).toBe("~  ok");
  });
});
