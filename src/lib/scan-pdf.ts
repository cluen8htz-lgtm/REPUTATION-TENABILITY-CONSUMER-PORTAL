/**
 * scan-pdf.ts — turn camera photos into one PDF, entirely in the browser.
 * Each photo is EXIF-rotated, downscaled (≤2000 px long edge), optionally
 * "enhanced" (grayscale + contrast, like a document scanner), re-encoded as
 * JPEG and fit onto a US Letter page with margins, aspect ratio preserved.
 */
const LETTER = { width: 612, height: 792 };
const MARGIN = 18;
const MAX_EDGE = 2000;

async function toJpeg(photo: Blob, enhance: boolean): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  if (enhance) ctx.filter = "grayscale(1) contrast(1.35) brightness(1.08)";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not encode a page.");
  return { bytes: await blob.arrayBuffer(), width, height };
}

export async function buildScanPdf(photos: Blob[], options: { enhance: boolean; fileName: string }): Promise<File> {
  if (photos.length === 0) throw new Error("Add at least one page.");
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setProducer("Reputation Tenability web scanner");
  doc.setCreationDate(new Date());
  for (const photo of photos) {
    const jpeg = await toJpeg(photo, options.enhance);
    const image = await doc.embedJpg(jpeg.bytes);
    const page = doc.addPage([LETTER.width, LETTER.height]);
    const fit = Math.min((LETTER.width - 2 * MARGIN) / jpeg.width, (LETTER.height - 2 * MARGIN) / jpeg.height);
    const w = jpeg.width * fit;
    const h = jpeg.height * fit;
    page.drawImage(image, { x: (LETTER.width - w) / 2, y: (LETTER.height - h) / 2, width: w, height: h });
  }
  const bytes = await doc.save();
  return new File([bytes as BlobPart], options.fileName, { type: "application/pdf" });
}

export function scanFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Scan-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.pdf`;
}
