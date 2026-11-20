/**
 * annotate.ts — regenerates a statement with its violation marks.
 *
 * For PDF statements the original pages are preserved byte-for-byte as page
 * content and overlaid with:
 *   - RED TRIANGLES around summary-level fields (credit limit, account summary)
 *   - RED BRACKETS under line items (credits, balances, due date, interest)
 *   - a red page frame for whole-statement defects (FCBA-005)
 *   - numbered margin callouts tying each mark to its statute
 * The located text positions come from the PDF's own text layer. When a field
 * can't be located (scanned image, unusual layout) the finding still appears
 * on the appended Violation Map pages, flagged "location not detected".
 *
 * Images are embedded as the first page; text files are typeset. Either way a
 * Violation Map is appended, so every exhibit gets an annotated companion.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { extractTextItems } from "unpdf";
import type { RuleHit } from "@contracts/fcba-engine";

const RED = rgb(0.86, 0.08, 0.1);
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const GOLD = rgb(0.72, 0.56, 0.24);

/** Text-layer anchors for each rule's markTarget. Ordered by specificity. */
export const TARGET_PATTERNS: Record<string, RegExp[]> = {
  creditLimit: [/^credit\s*(access\s*)?line\b/i, /credit\s*limit/i],
  creditsLine: [/^credits?\b(?!\s*limit)/i, /^\+?\s*credits/i],
  paymentsCredits: [/payments?,?\s*(and\s*)?(other\s*)?credits/i],
  interestCharges: [/interest\s*charged?/i, /finance\s*charge/i],
  newBalance: [/new\s*balance/i, /ending\s*balance/i],
  previousBalance: [/previous\s*balance/i, /beginning\s*balance/i, /opening\s*balance/i],
  dueDate: [/payment\s*due\s*date/i, /due\s*date/i],
  ytdTotals: [/year[-\s]*to[-\s]*date/i, /total\s*interest\s*charged\s*in\s*\d{4}/i],
  accountSummary: [/account\s*summary/i, /summary\s*of\s*account/i],
  tradeline: [/payment\s*history/i, /account\s*status/i],
  paymentHistory: [/payment\s*history/i, /\b30\b.*days?\s*late/i],
};

type Located = { page: number; x: number; y: number; width: number; height: number; rowRight: number };

/** Replace characters outside WinAnsi (the standard PDF fonts' encoding). */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/≈/g, "~")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/→/g, "->")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || code === 0x2013 || code === 0x2014 || code === 0x2022 || code === 0x20ac;
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

async function locateTargets(bytes: Uint8Array, targets: string[]): Promise<Map<string, Located>> {
  const found = new Map<string, Located>();
  try {
    const { items } = await extractTextItems(new Uint8Array(bytes));
    for (const target of targets) {
      const patterns = TARGET_PATTERNS[target];
      if (!patterns || found.has(target)) continue;
      outer: for (const pattern of patterns) {
        for (let page = 0; page < items.length; page++) {
          for (const item of items[page]) {
            if (!item.str.trim() || !pattern.test(item.str.trim())) continue;
            // Extend to the rightmost item on the same baseline (captures the amount).
            const row = items[page].filter((other) => Math.abs(other.y - item.y) < Math.max(2, item.height * 0.4) && other.x >= item.x);
            const rowRight = Math.max(item.x + item.width, ...row.map((other) => other.x + other.width));
            found.set(target, { page, x: item.x, y: item.y, width: item.width, height: Math.max(item.height, item.fontSize, 6), rowRight });
            break outer;
          }
        }
      }
    }
  } catch {
    // No text layer (scanned/encrypted) — marks fall back to the violation map.
  }
  return found;
}

function drawTriangle(page: PDFPage, loc: Located, font: PDFFont) {
  // Red outline around the whole field (label + amount) …
  const pad = 3;
  page.drawRectangle({
    x: loc.x - pad * 2,
    y: loc.y - pad,
    width: loc.rowRight - loc.x + pad * 4,
    height: loc.height + pad * 2,
    borderColor: RED,
    borderWidth: 1.6,
  });
  // … and a solid red warning triangle in the left margin pointing at it.
  const size = Math.max(12, loc.height + 6);
  const right = loc.x - pad * 2 - 4;
  const left = right - size;
  const base = loc.y - pad;
  const apexY = base + size * 0.9;
  page.drawSvgPath(`M ${left} ${-base} L ${right} ${-base} L ${(left + right) / 2} ${-apexY} Z`, { x: 0, y: 0, color: RED, borderColor: RED, borderWidth: 0.8 });
  page.drawText("!", { x: (left + right) / 2 - font.widthOfTextAtSize("!", size * 0.55) / 2, y: base + size * 0.12, size: size * 0.55, font, color: rgb(1, 1, 1) });
}

function drawBracket(page: PDFPage, loc: Located) {
  const y = loc.y - 3;
  const left = loc.x - 2;
  const right = loc.rowRight + 2;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, color: RED, thickness: 1.4 });
  page.drawLine({ start: { x: left, y }, end: { x: left, y: y + 5 }, color: RED, thickness: 1.4 });
  page.drawLine({ start: { x: right, y }, end: { x: right, y: y + 5 }, color: RED, thickness: 1.4 });
}

const usedSlots = new WeakMap<PDFPage, number[]>();

/** Place a numbered callout in the right margin, nudging it to avoid overlaps. */
function drawCallout(page: PDFPage, font: PDFFont, number: number, loc: Located | null, slot: number) {
  const { width, height } = page.getSize();
  const x = width - 26;
  const wanted = loc ? Math.min(height - 20, Math.max(20, loc.y + loc.height / 2)) : height - 40 - slot * 22;
  const used = usedSlots.get(page) ?? [];
  const free = (candidate: number) => candidate > 12 && candidate < height - 12 && !used.some((other) => Math.abs(other - candidate) < 19);
  let y = wanted;
  for (let step = 1; !free(y) && step < 60; step++) y = wanted + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 19;
  used.push(y);
  usedSlots.set(page, used);
  page.drawCircle({ x, y, size: 9, color: RED, opacity: 0.95 });
  const label = String(number);
  page.drawText(label, { x: x - font.widthOfTextAtSize(label, 9) / 2, y: y - 3.2, size: 9, font, color: rgb(1, 1, 1) });
  if (loc) {
    const anchorY = loc.y + loc.height / 2;
    page.drawLine({ start: { x: loc.rowRight + 10, y: anchorY }, end: { x: x - 30, y: anchorY }, color: RED, thickness: 0.6, dashArray: [2, 2] });
    page.drawLine({ start: { x: x - 30, y: anchorY }, end: { x: x - 10, y }, color: RED, thickness: 0.6, dashArray: [2, 2] });
  }
}

export type AnnotateInput = {
  bytes: Uint8Array;
  contentType: string;
  exhibitLabel: string;
  fileName: string;
  cycle?: string | null;
  hits: RuleHit[];
  complianceScore: number;
  generatedAt?: Date;
};

export type AnnotateResult = { pdf: Uint8Array; located: Record<string, number | null> };

export async function annotateStatement(input: AnnotateInput): Promise<AnnotateResult> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  out.setTitle(pdfSafe(`${input.exhibitLabel} — annotated violation map`));
  out.setProducer("Reputation Tenability FCBA Analyzer");
  out.setCreationDate(input.generatedAt ?? new Date());

  const located: Record<string, number | null> = {};
  let sourcePages: PDFPage[] = [];

  if (input.contentType === "application/pdf") {
    const source = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(source, source.getPageIndices());
    sourcePages = copied.map((page) => out.addPage(page));
    const targets = [...new Set(input.hits.map((hit) => hit.markTarget))];
    const positions = await locateTargets(input.bytes, targets);
    let slot = 0;
    input.hits.forEach((hit, index) => {
      const loc = positions.get(hit.markTarget) ?? null;
      located[hit.ruleId] = loc ? loc.page + 1 : null;
      if (hit.mark === "wholePage") {
        const page = sourcePages[0];
        if (!page) return;
        const { width, height } = page.getSize();
        page.drawRectangle({ x: 8, y: 8, width: width - 16, height: height - 16, borderColor: RED, borderWidth: 2.5, opacity: 0 });
        const stamp = "NON-COMPLIANT STATEMENT - 15 U.S.C. 1666(b)(6)";
        page.drawText(stamp, { x: 18, y: height - 22, size: 8, font: bold, color: RED });
        drawCallout(page, bold, index + 1, null, slot++);
        return;
      }
      if (!loc) return;
      const page = sourcePages[loc.page];
      if (hit.mark === "triangle") drawTriangle(page, loc, bold);
      else drawBracket(page, loc);
      drawCallout(page, bold, index + 1, loc, slot);
    });
  } else if (/^image\/(png|jpeg)$/.test(input.contentType)) {
    const image = input.contentType === "image/png" ? await out.embedPng(input.bytes) : await out.embedJpg(input.bytes);
    const scale = Math.min(572 / image.width, 752 / image.height, 1);
    const page = out.addPage([612, 792]);
    page.drawImage(image, { x: (612 - image.width * scale) / 2, y: 792 - 20 - image.height * scale, width: image.width * scale, height: image.height * scale });
    input.hits.forEach((hit, index) => { located[hit.ruleId] = null; drawCallout(page, bold, index + 1, null, index); });
    sourcePages = [page];
  } else {
    const text = Buffer.from(input.bytes).toString("utf8").slice(0, 200_000);
    let page = out.addPage([612, 792]);
    let y = 760;
    for (const line of wrap(text, font, 9, 540)) {
      if (y < 40) { page = out.addPage([612, 792]); y = 760; }
      page.drawText(line, { x: 36, y, size: 9, font, color: INK });
      y -= 12;
    }
    input.hits.forEach((hit) => { located[hit.ruleId] = null; });
  }

  // ---- Violation map pages ----
  let page = out.addPage([612, 792]);
  let y = 750;
  const ensure = (needed: number) => {
    if (y - needed < 50) { page = out.addPage([612, 792]); y = 750; }
  };
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: INK });
  page.drawText("FCBA / TILA VIOLATION MAP", { x: 36, y: 768, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText(pdfSafe(`${input.exhibitLabel} · ${input.fileName}${input.cycle ? ` · cycle ${input.cycle}` : ""}`), { x: 36, y: 752, size: 9, font, color: rgb(0.85, 0.85, 0.85) });
  y = 720;
  page.drawText(`Screening score: ${input.complianceScore}/100`, { x: 36, y, size: 11, font: bold, color: input.complianceScore < 60 ? RED : INK });
  page.drawText(`${input.hits.length} finding(s) · generated ${(input.generatedAt ?? new Date()).toISOString().slice(0, 10)}`, { x: 220, y, size: 9, font, color: MUTED });
  y -= 18;
  page.drawText("Legend: red triangle = summary-level field  ·  red bracket = line item  ·  red frame = whole statement", { x: 36, y, size: 8, font, color: MUTED });
  y -= 22;

  if (input.hits.length === 0) {
    page.drawText("No screening findings for this exhibit.", { x: 36, y, size: 11, font, color: INK });
    y -= 20;
  }
  input.hits.forEach((hit, index) => {
    const where = located[hit.ruleId];
    const header = `[${hit.ruleId}] ${hit.title}`;
    const body = [
      `Severity: ${hit.severity.toUpperCase()}   Mark: ${hit.mark}${hit.mark === "wholePage" ? "" : ` @ ${hit.markTarget}`}   Location: ${where ? `page ${where}` : hit.mark === "wholePage" ? "page 1 (whole statement)" : hit.mark === "note" ? "correspondence file (no statement field)" : "field not detected in the text layer"}`,
      `Authority: ${hit.statute}`,
      `Finding: ${hit.excerpt}`,
      `Annotation: ${hit.annotation}`,
    ];
    const lines = body.flatMap((line) => wrap(line, font, 8.5, 500));
    ensure(24 + lines.length * 11);
    page.drawCircle({ x: 44, y: y + 3, size: 8, color: hit.severity === "critical" ? RED : hit.severity === "major" ? GOLD : MUTED });
    const n = String(index + 1);
    page.drawText(n, { x: 44 - bold.widthOfTextAtSize(n, 8) / 2, y: y, size: 8, font: bold, color: rgb(1, 1, 1) });
    for (const line of wrap(header, bold, 10, 500)) {
      page.drawText(line, { x: 60, y, size: 10, font: bold, color: INK });
      y -= 13;
    }
    for (const line of lines) {
      page.drawText(line, { x: 60, y, size: 8.5, font, color: INK });
      y -= 11;
    }
    y -= 10;
  });
  ensure(40);
  for (const line of wrap("Screening work product prepared for attorney review. Marks are generated from the statement's text layer and the facts on file; they are not legal conclusions. The original statement pages are reproduced unaltered beneath the overlay.", font, 7.5, 540)) {
    page.drawText(line, { x: 36, y, size: 7.5, font, color: MUTED });
    y -= 10;
  }
  return { pdf: await out.save(), located };
}

/** Simple text → PDF typesetting for letters and reports. */
export async function textToPdf(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  doc.setTitle(pdfSafe(title));
  let page = doc.addPage([612, 792]);
  let y = 740;
  page.drawText(pdfSafe(title), { x: 72, y, size: 13, font: bold, color: INK });
  y -= 26;
  for (const line of wrap(body, font, 11, 468)) {
    if (y < 72) { page = doc.addPage([612, 792]); y = 720; }
    const heading = /^[A-Z0-9 ,.'§()/&—-]{6,}$/.test(line.trim()) && line.trim().length < 80;
    page.drawText(line, { x: 72, y, size: 11, font: heading ? bold : font, color: INK });
    y -= 15;
  }
  return doc.save();
}
