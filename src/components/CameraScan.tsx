import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, FileCheck2, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { buildScanPdf, scanFileName } from "@/lib/scan-pdf";

type Page = { id: string; blob: Blob; url: string };

/**
 * Multi-page document capture in the browser. On phones the camera opens
 * directly; on computers it falls back to choosing photos. Produces one PDF.
 */
export function CameraScan({ onReady, onError }: { onReady: (file: File, pages: number) => void; onError: (message: string) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [building, setBuilding] = useState(false);

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), [pages]);

  function add(files: FileList | null) {
    if (!files?.length) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length !== files.length) onError("Only photos can be added as scan pages.");
    setPages((prev) => [...prev, ...images.map((blob) => ({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) }))].slice(0, 30));
  }
  function remove(id: string) {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }
  function move(index: number, delta: number) {
    setPages((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
      return next;
    });
  }
  async function finish() {
    setBuilding(true);
    try {
      const file = await buildScanPdf(pages.map((p) => p.blob), { enhance, fileName: scanFileName() });
      if (file.size > 15_000_000) throw new Error("The scan is larger than 15 MB. Remove a page or split it into two exhibits.");
      onReady(file, pages.length);
      setPages([]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not build the PDF.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="camera-scan">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <div className="scan-actions">
        <button type="button" className="gold-button" onClick={() => camera.current?.click()}><Camera />{pages.length ? "Scan next page" : "Scan first page"}</button>
        <button type="button" className="outline-button" onClick={() => gallery.current?.click()}><ImagePlus />Add from photos</button>
      </div>
      <p className="scan-tip">Lay the page flat on a dark surface, fill the frame, and avoid shadows. One photo per page.</p>
      {pages.length > 0 && <>
        <ol className="scan-pages" aria-label="Scanned pages">
          {pages.map((p, i) => (
            <li key={p.id}>
              <img src={p.url} alt={`Page ${i + 1}`} className={enhance ? "enhanced" : ""} />
              <span className="page-no">{i + 1}</span>
              <div className="page-tools">
                <button type="button" aria-label={`Move page ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft /></button>
                <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => remove(p.id)}><Trash2 /></button>
                <button type="button" aria-label={`Move page ${i + 1} later`} disabled={i === pages.length - 1} onClick={() => move(i, 1)}><ArrowRight /></button>
              </div>
            </li>
          ))}
        </ol>
        <label className="check-inline"><input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /><Sparkles className="inline-icon" />Enhance (black &amp; white, sharper text)</label>
        <div className="form-actions start"><button type="button" className="gold-button" disabled={building} onClick={finish}><FileCheck2 />{building ? "Building PDF…" : `Use these ${pages.length} page(s)`}</button></div>
      </>}
    </div>
  );
}
