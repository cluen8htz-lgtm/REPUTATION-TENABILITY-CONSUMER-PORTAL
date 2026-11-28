import { ScanLine, Smartphone, Download } from "lucide-react";
import { trpc } from "@/providers/trpc";

/** Promotes the RT Scanner Android app, which files scans into the same exhibit list. */
export function AppDownloadCard({ compact = false }: { compact?: boolean }) {
  const config = trpc.auth.config.useQuery(undefined, { staleTime: 300_000 });
  const url = config.data?.scannerAppUrl;
  if (!url) return null;
  return (
    <aside className={`app-card${compact ? " compact" : ""}`}>
      <div className="app-card-icon"><Smartphone /><ScanLine /></div>
      <div className="app-card-copy">
        <span className="app-card-eyebrow">RT SCANNER · ANDROID</span>
        <strong>Get the scanner app</strong>
        {!compact && <p>Auto-crop, de-skew and multi-page scanning with your phone camera. Sign in with the same account (or Google) and every scan is filed here as the next lettered exhibit.</p>}
      </div>
      <a className="gold-button" href={url} target="_blank" rel="noopener noreferrer"><Download />Download for Android</a>
    </aside>
  );
}
