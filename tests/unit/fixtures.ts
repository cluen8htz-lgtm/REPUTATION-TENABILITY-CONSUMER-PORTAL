import { PDFDocument, StandardFonts } from "pdf-lib";
import { EMPTY_FACTS, type StatementFacts } from "../../contracts/fcba-engine";

/** A first periodic statement modeled on the Cuevas Exhibit A pattern. */
export const CUEVAS_AUGUST: StatementFacts = {
  ...EMPTY_FACTS,
  isFirstStatement: true,
  statementDate: "2025-08-05",
  dueDate: "2025-09-02",
  creditLimit: 8000,
  previousBalance: 0,
  newBalance: 779.8,
  creditsTotal: 0,
  paymentsCreditsNet: -200,
  hasItemizedCredits: false,
  hasCreditLineItem: false,
  originationCreditClaimed: 8000,
  hasCreditDebitDesignation: false,
  balanceComputationDisclosed: false,
  documentsRequested: true,
  creditorProducedDocuments: false,
};

export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const rows: Array<[string, string, number]> = [
    ["ACCOUNT SUMMARY", "", 720],
    ["Previous Balance", "$0.00", 700],
    ["Payments, Credits", "-$200.00", 685],
    ["Purchases", "+$910.80", 670],
    ["Credits", "$0.00", 655],
    ["New Balance", "$779.80", 640],
    ["Payment Due Date", "09/02/25", 625],
    ["Credit Limit", "$8,000", 610],
    ["Interest Charged", "$0.00", 595],
  ];
  for (const [label, value, y] of rows) {
    page.drawText(label, { x: 60, y, size: 10, font });
    if (value) page.drawText(value, { x: 260, y, size: 10, font });
  }
  return doc.save();
}
