import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, FileUp, Triangle, Brackets, Frame, StickyNote } from "lucide-react";
import { daysBetween, deadlineStatus } from "@contracts/fcba-engine";
import { MAX_UPLOAD, todayIso } from "@/lib/files";

/** Drag-and-drop or click-to-choose file picker with size validation. */
export function FileDrop({ file, onFile, hint, accept, capture }: { file: File | null; onFile: (file: File | null, error?: string) => void; hint: string; accept?: string; capture?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (picked: File | undefined | null) => {
    if (!picked) return onFile(null);
    if (picked.size > MAX_UPLOAD) return onFile(null, `${picked.name} is larger than 15 MB.`);
    onFile(picked);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files?.[0]);
  };
  return (
    <div
      className={`file-drop ${over ? "over" : ""} ${file ? "has-file" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}
    >
      <FileUp aria-hidden="true" />
      <span>
        <strong>{file ? file.name : "Drop a file here or choose one"}</strong>
        <small>{file ? `${(file.size / 1024).toFixed(0)} KB · ready to file` : hint}</small>
      </span>
      <input ref={input} type="file" hidden accept={accept} {...(capture ? { capture: "environment" } : {})} onChange={(event) => take(event.target.files?.[0])} />
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: "critical" | "major" | "minor" | string }) {
  return <span className={`severity severity-${severity}`}>{severity}</span>;
}

export function MarkIcon({ mark }: { mark: string }) {
  const Icon = mark === "triangle" ? Triangle : mark === "bracket" ? Brackets : mark === "wholePage" ? Frame : StickyNote;
  return <Icon className={`mark-icon mark-${mark}`} aria-label={`${mark} mark`} />;
}

export function DeadlineChip({ label, date, met }: { label: string; date: string | null | undefined; met?: boolean }) {
  if (!date) return <span className="deadline-chip muted"><CalendarClock />{label}: add receipt date</span>;
  const status = deadlineStatus(date, todayIso(), met)!;
  const days = daysBetween(todayIso(), date.slice(0, 10));
  const text = status === "met" ? "met" : status === "overdue" ? `${-days} day(s) overdue` : `${days} day(s) left`;
  const Icon = status === "met" ? CheckCircle2 : status === "overdue" ? CircleAlert : CalendarClock;
  return <span className={`deadline-chip ${status}`}><Icon />{label}: {date.slice(0, 10)} · {text}</span>;
}

/** Semi-circular gauge; `invert` for risk scores (higher = worse). */
export function ScoreGauge({ value, label, invert }: { value: number | null | undefined; label: string; invert?: boolean }) {
  if (value === null || value === undefined) return <div className="score-gauge empty"><strong>—</strong><span>{label}</span></div>;
  const goodness = invert ? 100 - value : value;
  const tone = goodness >= 75 ? "good" : goodness >= 45 ? "warn" : "bad";
  const angle = (value / 100) * 180;
  return (
    <div className={`score-gauge ${tone}`} role="img" aria-label={`${label}: ${value} of 100`}>
      <svg viewBox="0 0 120 66" aria-hidden="true">
        <path d="M10 60 A50 50 0 0 1 110 60" className="track" />
        <path d="M10 60 A50 50 0 0 1 110 60" className="value" style={{ strokeDasharray: `${(angle / 180) * 157} 157` }} />
      </svg>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="module-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value} className={tab.value === value ? "active" : ""} onClick={() => onChange(tab.value)}>
          {tab.label}{tab.count !== undefined && <em>{tab.count}</em>}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warn"; children: ReactNode }) {
  return <div className={`module-notice ${tone}`} role="status">{children}</div>;
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="module-steps">
      {steps.map((step, index) => <li key={step} className={index < current ? "done" : index === current ? "current" : ""}><span>{index + 1}</span>{step}</li>)}
    </ol>
  );
}
