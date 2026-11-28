/**
 * FcbaPage.tsx — Credit card billing error (FCBA) workspace. Route: /portal/billing-error
 *
 * Exhibits → facts review (AI-extracted or entered, live rule preview) →
 * violation map → disputes with 30/90-day clocks, letters, creditor responses →
 * ZIP exhibit bundle and calendar feed.
 */
import { useMemo, useState } from "react";
import { CalendarPlus, Camera, Download, FileCheck2, FileText, Gavel, Play, RefreshCw, Save, Send, Sparkles, Trash2, TriangleAlert, Upload } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle } from "@/components/PortalComponents";
import { CameraScan } from "@/components/CameraScan";
import { AppDownloadCard } from "@/components/AppDownloadCard";
import { DeadlineChip, FileDrop, MarkIcon, Notice, ScoreGauge, SeverityBadge, Steps, Tabs } from "@/components/ModuleKit";
import { fileToBase64, todayIso } from "@/lib/files";
import { EXHIBIT_CATEGORIES, FCBA_RULES } from "@contracts/fcba";
import { EMPTY_FACTS, complianceScore, disputeWindowCloses, evaluateStatement, type StatementFacts } from "@contracts/fcba-engine";

type Tab = "exhibits" | "map" | "disputes";
type NoticeType = "billing_error" | "noncompliance_notice" | "arbitration_demand";

export default function FcbaPage() {
  const utils = trpc.useUtils();
  const config = trpc.auth.config.useQuery();
  const statements = trpc.fcba.listStatements.useQuery();
  const violations = trpc.fcba.listViolations.useQuery();
  const disputes = trpc.fcba.listDisputes.useQuery();
  const timeline = trpc.fcba.timeline.useQuery();
  const [tab, setTab] = useState<Tab>("exhibits");
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warn"; text: string } | null>(null);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const refresh = () => Promise.all([utils.fcba.invalidate(), utils.portal.dashboard.invalidate()]);

  if (statements.isLoading) return <LoadingPanel />;
  const stmts = statements.data ?? [];
  const hits = violations.data ?? [];
  const analyzed = stmts.filter((s) => s.analysisStatus === "complete" && s.complianceScore !== null);
  const avgScore = analyzed.length ? Math.round(analyzed.reduce((t, s) => t + (s.complianceScore ?? 0), 0) / analyzed.length) : null;
  const step = disputes.data?.some((d) => d.letterDraft) ? 3 : disputes.data?.length ? 2 : hits.length ? 1 : 0;

  return <div className="module-page">
    <PageTitle eyebrow="FAIR CREDIT BILLING ACT" title="Credit card billing error" description="File each statement as a labeled exhibit. Facts are read from the document, checked by an auditable rule engine, and marked on a regenerated statement — red triangles at summary fields, red brackets under line items — before your dispute package is drafted for attorney review." action={<a className="gold-button" href="/api/bundles/fcba.zip"><Download />Exhibit bundle (.zip)</a>} />
    <Steps steps={["File exhibits", "Review violation map", "Open dispute", "Draft & track"]} current={step} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {config.data && !config.data.ai && <Notice tone="warn">AI document reading is not configured on this server. Enter statement figures with “Review facts” — the rule engine, annotation, and letter templates all work without AI.</Notice>}

    <section className="module-summary">
      <ScoreGauge value={avgScore} label="avg. screening score" />
      <div className="metric"><span>EXHIBITS</span><strong>{stmts.length}</strong><small>{analyzed.length} analyzed</small></div>
      <div className="metric"><span>FINDINGS</span><strong>{hits.length}</strong><small>{hits.filter((h) => h.severity === "critical").length} critical</small></div>
      <div className="metric"><span>DISPUTES</span><strong>{disputes.data?.length ?? 0}</strong><a href="/api/calendar/deadlines.ics"><CalendarPlus />Add deadlines to calendar</a></div>
    </section>

    <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "exhibits", label: "Exhibits", count: stmts.length }, { value: "map", label: "Violation map", count: hits.length }, { value: "disputes", label: "Disputes & letters", count: disputes.data?.length ?? 0 }]} />

    {tab === "exhibits" && <>
      <UploadPanel onDone={async (message, id, analyzable) => {
        setNotice({ tone: "success", text: message });
        await refresh();
        if (id && analyzable && config.data?.ai) setReviewId(null);
      }} aiEnabled={Boolean(config.data?.ai)} onError={(text) => setNotice({ tone: "warn", text })} />
      <AppDownloadCard compact />
      {stmts.length === 0 ? <EmptyState title="No exhibits yet" text="Start with the first periodic statement after the account opened, then add each later statement in order." /> :
        <div className="exhibit-table" role="table" aria-label="Exhibits">
          {stmts.map((s) => <ExhibitRow key={s.id} stmt={s} findings={hits.filter((h) => h.statementId === s.id).length} aiEnabled={Boolean(config.data?.ai)} onReview={() => setReviewId(s.id)} onChanged={refresh} onNotice={setNotice} />)}
        </div>}
      {reviewId && <FactsReview id={reviewId} onClose={() => setReviewId(null)} onSaved={async (text) => { setNotice({ tone: "success", text }); setReviewId(null); await refresh(); setTab("map"); }} />}
    </>}

    {tab === "map" && <ViolationMap stmts={stmts} hits={hits} />}

    {tab === "disputes" && <DisputesPanel hasFindings={hits.length > 0} onNotice={setNotice} onChanged={refresh} />}

    <section className="work-section timeline-section">
      <div className="work-section-heading"><h2>Activity</h2></div>
      {(timeline.data ?? []).length === 0 ? <p className="muted-copy">Receipts, analyses, drafts, and responses will be logged here.</p> :
        <ol className="timeline">{timeline.data!.slice(0, 15).map((e) => <li key={e.id}><time>{new Date(e.createdAt).toLocaleString()}</time><p>{e.message}</p></li>)}</ol>}
    </section>
  </div>;
}

function UploadPanel({ onDone, onError, aiEnabled }: { onDone: (message: string, id?: number, analyzable?: boolean) => void; onError: (text: string) => void; aiEnabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"scan" | "file">("scan");
  const [scanned, setScanned] = useState<number | null>(null);
  const [category, setCategory] = useState("statements");
  const [cycle, setCycle] = useState("");
  const [isFirst, setIsFirst] = useState(false);
  const analyze = trpc.fcba.analyzeStatement.useMutation();
  const upload = trpc.fcba.uploadStatement.useMutation({ onError: (e) => onError(e.message) });
  const busy = upload.isPending || analyze.isPending;
  const submit = async () => {
    if (!file) return;
    const result = await upload.mutateAsync({ name: file.name, contentBase64: await fileToBase64(file), contentType: file.type || undefined, category: category as "statements", cycle: cycle || undefined, isFirstStatement: isFirst });
    setFile(null); setScanned(null); setCycle(""); setIsFirst(false);
    onDone(result.message + (result.analyzable && aiEnabled ? " Reading the statement now…" : ""), result.id, result.analyzable);
    if (result.analyzable && aiEnabled) {
      const analysis = await analyze.mutateAsync({ id: result.id });
      onDone("error" in analysis && analysis.error ? analysis.error : `${result.exhibitLabel} analyzed: ${analysis.hits.length} finding(s), screening score ${analysis.complianceScore}/100. Review the extracted facts to confirm.`);
    }
  };
  return <section className="upload-panel module-upload">
    <div className="mode-switch" role="tablist" aria-label="How to add the exhibit">
      <button type="button" role="tab" aria-selected={mode === "scan"} className={mode === "scan" ? "active" : ""} onClick={() => setMode("scan")}><Camera />Scan with camera</button>
      <button type="button" role="tab" aria-selected={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}><Upload />Upload a file</button>
    </div>
    {mode === "file"
      ? <FileDrop file={file} onFile={(f, err) => { setFile(f); setScanned(null); if (err) onError(err); }} hint="PDF statements work best (text layer is used to place marks) · images and text accepted · up to 15 MB" accept=".pdf,image/*,.txt" />
      : file && scanned
        ? <div className="file-drop has-file"><FileCheck2 aria-hidden="true" /><span><strong>{file.name}</strong><small>{scanned} page(s) · {(file.size / 1024).toFixed(0)} KB · ready to file</small></span><button type="button" className="text-switch" onClick={() => { setFile(null); setScanned(null); }}>Rescan</button></div>
        : <CameraScan onReady={(f, n) => { setFile(f); setScanned(n); }} onError={onError} />}
    <div className="field-grid three-columns">
      <label>Exhibit category<select value={category} onChange={(e) => setCategory(e.target.value)}>{EXHIBIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <label>Billing cycle<input placeholder="07/15/25–08/05/25" value={cycle} onChange={(e) => setCycle(e.target.value)} /></label>
      <label className="check-inline"><input type="checkbox" checked={isFirst} onChange={(e) => setIsFirst(e.target.checked)} />First periodic statement on the account</label>
    </div>
    <div className="form-actions"><button className="gold-button" disabled={!file || busy} onClick={submit}><Upload />{upload.isPending ? "Filing…" : analyze.isPending ? "Analyzing…" : "File exhibit"}</button></div>
  </section>;
}

type StatementRow = { id: number; exhibitLabel: string; fileName: string; folder: string; cycle: string | null; category: string; analysisStatus: string; analysisError: string | null; complianceScore: number | null; annotatedFileKey: string | null; factsSource: string | null };

function ExhibitRow({ stmt, findings, aiEnabled, onReview, onChanged, onNotice }: { stmt: StatementRow; findings: number; aiEnabled: boolean; onReview: () => void; onChanged: () => void; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void }) {
  const analyze = trpc.fcba.analyzeStatement.useMutation({
    onSuccess: (r) => { onNotice("error" in r && r.error ? { tone: "warn", text: r.error } : { tone: "success", text: `${stmt.exhibitLabel}: ${r.hits.length} finding(s), score ${r.complianceScore}/100.` }); onChanged(); },
  });
  const remove = trpc.fcba.removeStatement.useMutation({ onSuccess: onChanged });
  const analyzable = stmt.category === "statements" || stmt.category === "credit_reports";
  return <div className="exhibit-row" role="row">
    <span className="exhibit-label">{stmt.exhibitLabel.replace("Exhibit ", "")}</span>
    <div className="exhibit-main">
      <strong>{stmt.fileName}</strong>
      <small>{stmt.folder}{stmt.cycle ? ` · ${stmt.cycle}` : ""}{stmt.factsSource ? ` · facts: ${stmt.factsSource.replace("_", " ")}` : ""}</small>
      {stmt.analysisStatus === "failed" && stmt.analysisError && <small className="error-text">{stmt.analysisError}</small>}
    </div>
    <span className={`analysis-status ${stmt.analysisStatus}`}>{analyze.isPending ? "analyzing" : stmt.analysisStatus}</span>
    <span className="exhibit-score">{stmt.complianceScore !== null ? `${stmt.complianceScore}/100` : "—"}<small>{findings} finding(s)</small></span>
    <div className="row-actions">
      <a href={`/api/files/fcba/${stmt.id}`} target="_blank" rel="noreferrer" title="Open original"><FileText />Original</a>
      {stmt.annotatedFileKey && <a className="annotated-link" href={`/api/files/fcba-annotated/${stmt.id}`} target="_blank" rel="noreferrer" title="Open annotated statement"><TriangleAlert />Annotated</a>}
      {analyzable && aiEnabled && <button type="button" onClick={() => analyze.mutate({ id: stmt.id })} disabled={analyze.isPending}>{stmt.analysisStatus === "complete" ? <RefreshCw /> : <Play />}{stmt.analysisStatus === "complete" ? "Re-read" : "Analyze"}</button>}
      {analyzable && <button type="button" onClick={onReview}><Sparkles />Review facts</button>}
      <button type="button" className="danger" onClick={() => { if (confirm(`Remove ${stmt.exhibitLabel}? Its findings are deleted too.`)) remove.mutate({ id: stmt.id }); }}><Trash2 /></button>
    </div>
  </div>;
}

type FieldSpec = { key: keyof StatementFacts; label: string; kind: "money" | "date" | "bool" | "number" | "tri" };
const FACT_GROUPS: Array<{ title: string; fields: FieldSpec[] }> = [
  { title: "Cycle", fields: [
    { key: "isFirstStatement", label: "First periodic statement", kind: "bool" },
    { key: "statementDate", label: "Closing date", kind: "date" },
    { key: "dueDate", label: "Payment due date", kind: "date" },
    { key: "priorStatementCompliant", label: "Prior statement compliant?", kind: "tri" },
  ] },
  { title: "Account summary", fields: [
    { key: "creditLimit", label: "Credit limit", kind: "money" },
    { key: "previousBalance", label: "Previous balance", kind: "money" },
    { key: "newBalance", label: "New balance", kind: "money" },
    { key: "creditsTotal", label: "Credits line", kind: "money" },
    { key: "paymentsCreditsNet", label: "'Payments, Credits' net", kind: "money" },
    { key: "originationCreditClaimed", label: "Origination credit asserted", kind: "money" },
  ] },
  { title: "Disclosures", fields: [
    { key: "hasCreditLineItem", label: "Extension of credit disclosed as a transaction", kind: "bool" },
    { key: "hasItemizedCredits", label: "Credits itemized by amount & date", kind: "bool" },
    { key: "hasCreditDebitDesignation", label: "Balances designated credit/debit", kind: "bool" },
    { key: "balanceComputationDisclosed", label: "Balance computation disclosed", kind: "bool" },
  ] },
  { title: "Interest & credits", fields: [
    { key: "apr", label: "Purchase APR (%)", kind: "number" },
    { key: "ytdInterest", label: "Interest year-to-date", kind: "money" },
    { key: "ytdFees", label: "Fees year-to-date", kind: "money" },
    { key: "disclosedBalanceForInterest", label: "Balance subject to interest", kind: "money" },
    { key: "creditBalanceAsserted", label: "Credit balance asserted", kind: "money" },
    { key: "creditBalanceRefunded", label: "Credit balance applied/refunded", kind: "bool" },
  ] },
  { title: "Documentary evidence", fields: [
    { key: "documentsRequested", label: "Signed credit document requested", kind: "bool" },
    { key: "creditorProducedDocuments", label: "Creditor produced it", kind: "bool" },
  ] },
];

function FactsReview({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: (text: string) => void }) {
  const detail = trpc.fcba.statement.useQuery({ id });
  const [draft, setDraft] = useState<StatementFacts | null>(null);
  const save = trpc.fcba.saveFacts.useMutation({ onSuccess: (r) => onSaved(`Rule engine re-run: ${r.hits.length} finding(s), score ${r.complianceScore}/100. Annotated statement regenerated.`) });
  const facts = useMemo(() => draft ?? detail.data?.facts ?? { ...EMPTY_FACTS, isFirstStatement: detail.data?.isFirstStatement ?? false }, [draft, detail.data]);
  const preview = useMemo(() => evaluateStatement(facts), [facts]);
  const set = <K extends keyof StatementFacts>(key: K, value: StatementFacts[K]) => setDraft({ ...facts, [key]: value });
  const tradeline = facts.tradeline;

  return <div className="facts-overlay" role="dialog" aria-modal="true" aria-label="Review statement facts">
    <div className="facts-panel">
      <header><div><p className="overline">{detail.data?.exhibitLabel ?? "EXHIBIT"} · FACTS REVIEW</p><h2>{detail.data?.fileName ?? "Loading…"}</h2><p>{detail.data?.factsSource === "ai" ? "These figures were read by AI. Check each against the statement before relying on them." : "Enter figures exactly as printed. Leave blank what the statement does not show."}</p></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <div className="facts-body">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate({ id, facts }); }}>
          {FACT_GROUPS.map((group) => <fieldset key={group.title}><legend>{group.title}</legend><div className="field-grid">
            {group.fields.map((f) => <FactField key={f.key} spec={f} value={facts[f.key]} onChange={(v) => set(f.key, v as never)} />)}
          </div></fieldset>)}
          <fieldset><legend>Credit-report tradeline</legend>
            <label className="check-inline"><input type="checkbox" checked={Boolean(tradeline)} onChange={(e) => set("tradeline", e.target.checked ? { reportsCurrent: false, pastDueAmount: null, lateRatingSameMonth: false, lateMarkerFromDefectiveStatement: false } : null)} />This exhibit is a credit report</label>
            {tradeline && <div className="field-grid">
              <label className="check-inline"><input type="checkbox" checked={tradeline.reportsCurrent} onChange={(e) => set("tradeline", { ...tradeline, reportsCurrent: e.target.checked })} />Reports "Current / Pays as agreed"</label>
              <label>Past-due amount<input type="number" step="0.01" value={tradeline.pastDueAmount ?? ""} onChange={(e) => set("tradeline", { ...tradeline, pastDueAmount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <label className="check-inline"><input type="checkbox" checked={tradeline.lateRatingSameMonth} onChange={(e) => set("tradeline", { ...tradeline, lateRatingSameMonth: e.target.checked })} />Late rating for the same month</label>
              <label className="check-inline"><input type="checkbox" checked={tradeline.lateMarkerFromDefectiveStatement} onChange={(e) => set("tradeline", { ...tradeline, lateMarkerFromDefectiveStatement: e.target.checked })} />Late marker traces to a defective statement</label>
            </div>}
          </fieldset>
          <div className="form-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="gold-button" disabled={save.isPending}><Save />{save.isPending ? "Running engine…" : "Save & re-run engine"}</button></div>
        </form>
        <aside className="live-preview" aria-live="polite">
          <ScoreGauge value={complianceScore(preview)} label="live screening score" />
          {facts.statementDate && <p className="muted-copy">Dispute window for this statement closes about <strong>{disputeWindowCloses(facts.statementDate)}</strong> (60 days from transmittal).</p>}
          <ul>{preview.length === 0 ? <li className="muted-copy">No rules fire on these facts.</li> : preview.map((h) => <li key={h.ruleId}><MarkIcon mark={h.mark} /><div><strong>{h.ruleId} · {h.title}</strong><small>{h.excerpt}</small></div><SeverityBadge severity={h.severity} /></li>)}</ul>
        </aside>
      </div>
    </div>
  </div>;
}

function FactField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (value: unknown) => void }) {
  if (spec.kind === "bool") return <label className="check-inline"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{spec.label}</label>;
  if (spec.kind === "tri") return <label>{spec.label}<select value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}><option value="">Unknown / first statement</option><option value="true">Yes</option><option value="false">No — defective</option></select></label>;
  if (spec.kind === "date") return <label>{spec.label}<input type="date" value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value || null)} /></label>;
  const isCredits = spec.key === "creditsTotal";
  return <label>{spec.label}<input type="number" step="0.01" inputMode="decimal" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? (isCredits ? 0 : null) : Number(e.target.value))} /></label>;
}

function ViolationMap({ stmts, hits }: { stmts: StatementRow[]; hits: Array<{ id: number; statementId: number; ruleId: string; title: string; statute: string; severity: string; excerpt: string; annotation: string; mark: string; markTarget: string | null; page: number | null }> }) {
  const [severity, setSeverity] = useState<"all" | "critical" | "major" | "minor">("all");
  const visible = hits.filter((h) => severity === "all" || h.severity === severity);
  const byRule = FCBA_RULES.map((rule) => ({ rule, count: hits.filter((h) => h.ruleId === rule.id).length })).filter((r) => r.count > 0);
  if (!hits.length) return <EmptyState title="No findings yet" text="Analyze a statement or enter its figures with “Review facts” to build the violation map." />;
  return <>
    <div className="rule-heatmap" aria-label="Findings by rule">{byRule.map(({ rule, count }) => <span key={rule.id} title={rule.title}><MarkIcon mark={rule.mark} />{rule.id}<em>{count}</em></span>)}</div>
    <div className="filter-row">{(["all", "critical", "major", "minor"] as const).map((s) => <button key={s} type="button" className={severity === s ? "active" : ""} onClick={() => setSeverity(s)}>{s}</button>)}</div>
    {stmts.filter((s) => visible.some((h) => h.statementId === s.id)).map((s) => <section key={s.id} className="map-group">
      <header><span className="exhibit-label">{s.exhibitLabel.replace("Exhibit ", "")}</span><div><strong>{s.fileName}</strong><small>{s.cycle ?? s.folder}</small></div>{s.annotatedFileKey && <a href={`/api/files/fcba-annotated/${s.id}`} target="_blank" rel="noreferrer"><TriangleAlert />Open marked statement</a>}</header>
      {visible.filter((h) => h.statementId === s.id).map((h) => <article key={h.id} className={`finding ${h.severity}`}>
        <MarkIcon mark={h.mark} />
        <div><p className="finding-head"><strong>{h.ruleId} · {h.title}</strong><SeverityBadge severity={h.severity} />{h.page ? <small>page {h.page}</small> : null}</p><p className="statute">{h.statute}</p><p>{h.excerpt}</p><details><summary>Annotation on the statement</summary><p>{h.annotation}</p></details></div>
      </article>)}
    </section>)}
  </>;
}

function DisputesPanel({ hasFindings, onNotice, onChanged }: { hasFindings: boolean; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void; onChanged: () => void }) {
  const disputes = trpc.fcba.listDisputes.useQuery();
  const config = trpc.auth.config.useQuery();
  const [form, setForm] = useState({ creditorName: "", accountLast4: "", noticeType: "billing_error" as NoticeType, creditorReceivedDate: "", sentVia: "USPS Certified Mail", trackingNumbers: "" });
  const create = trpc.fcba.createDispute.useMutation({
    onSuccess: () => { onNotice({ tone: "success", text: "Dispute opened. Generate the letter next." }); setForm({ ...form, creditorName: "", accountLast4: "", trackingNumbers: "" }); onChanged(); },
    onError: (e) => onNotice({ tone: "warn", text: e.message }),
  });
  return <>
    {!hasFindings && <Notice>Disputes are strongest once the violation map is built, but you can open one at any time.</Notice>}
    <form className="inset-form dispute-form" onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form, creditorReceivedDate: form.creditorReceivedDate || undefined, trackingNumbers: form.trackingNumbers || undefined }); }}>
      <div className="field-grid three-columns">
        <label>Creditor<input required value={form.creditorName} onChange={(e) => setForm({ ...form, creditorName: e.target.value })} placeholder="Card issuer legal name" /></label>
        <label>Account last 4<input required inputMode="numeric" maxLength={4} value={form.accountLast4} onChange={(e) => setForm({ ...form, accountLast4: e.target.value.replace(/\D/g, "") })} /></label>
        <label>Notice type<select value={form.noticeType} onChange={(e) => setForm({ ...form, noticeType: e.target.value as NoticeType })}><option value="billing_error">Billing-error notice (§1666)</option><option value="noncompliance_notice">Notice of FCBA non-compliance</option><option value="arbitration_demand">Pre-arbitration demand</option></select></label>
        <label>Date creditor received it<input type="date" value={form.creditorReceivedDate} max={todayIso()} onChange={(e) => setForm({ ...form, creditorReceivedDate: e.target.value })} /></label>
        <label>Sent via<input value={form.sentVia} onChange={(e) => setForm({ ...form, sentVia: e.target.value })} /></label>
        <label>Tracking number(s)<input value={form.trackingNumbers} onChange={(e) => setForm({ ...form, trackingNumbers: e.target.value })} /></label>
      </div>
      <div className="form-actions"><button className="gold-button" disabled={create.isPending}><Gavel />{create.isPending ? "Opening…" : "Open dispute"}</button></div>
    </form>
    {(disputes.data ?? []).length === 0 ? <EmptyState title="No disputes yet" text="Open the billing-error notice first; escalate to a non-compliance notice if the creditor's reply is boilerplate." /> :
      disputes.data!.map((d) => <DisputeCard key={d.id} dispute={d} aiEnabled={Boolean(config.data?.ai)} onNotice={onNotice} onChanged={onChanged} />)}
  </>;
}

type DisputeRow = { id: number; creditorName: string; accountLast4: string; noticeType: NoticeType; summary: string; status: string; creditorReceivedDate: string | null; sentVia: string | null; trackingNumbers: string | null; ackDeadline: string | null; resolveDeadline: string | null; letterDraft: string | null; letterSource: string | null; lastResponseClass: string | null };

function DisputeCard({ dispute, aiEnabled, onNotice, onChanged }: { dispute: DisputeRow; aiEnabled: boolean; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void; onChanged: () => void }) {
  const [letter, setLetter] = useState<string | null>(null);
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [responseDate, setResponseDate] = useState(todayIso());
  const events = trpc.fcba.disputeTimeline.useQuery({ disputeId: dispute.id });
  const generate = trpc.fcba.generateDisputeLetter.useMutation({ onSuccess: (r) => { setLetter(r.letter); onNotice(r.notice ? { tone: "warn", text: r.notice } : { tone: "success", text: `Letter drafted (${r.source}). Review and edit before sending.` }); onChanged(); } });
  const saveLetter = trpc.fcba.saveLetter.useMutation({ onSuccess: () => { onNotice({ tone: "success", text: "Letter saved." }); onChanged(); } });
  const update = trpc.fcba.updateDispute.useMutation({ onSuccess: onChanged });
  const respond = trpc.fcba.addCreditorResponse.useMutation({
    onSuccess: (r) => { setResponseFile(null); onNotice({ tone: r.escalated ? "warn" : "success", text: `${r.exhibitLabel}: response classified ${r.classification}. ${r.reasoning}${r.escalated ? " Consider a Notice of FCBA Non-Compliance." : ""}` }); onChanged(); events.refetch(); },
    onError: (e) => onNotice({ tone: "warn", text: e.message }),
  });
  const text = letter ?? dispute.letterDraft ?? "";
  const met = dispute.status === "acknowledged" || dispute.status === "resolved";
  return <article className="dispute-card">
    <header>
      <div><p className="overline">{dispute.noticeType.replaceAll("_", " ")}</p><h3>{dispute.creditorName} <small>····{dispute.accountLast4}</small></h3><p className="muted-copy">{dispute.summary}</p></div>
      <select aria-label="Dispute status" value={dispute.status} onChange={(e) => update.mutate({ id: dispute.id, status: e.target.value as "open" })}>{["open", "acknowledged", "escalated", "resolved", "arbitration"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
    </header>
    <div className="deadline-row">
      <DeadlineChip label="Acknowledge" date={dispute.ackDeadline} met={met} />
      <DeadlineChip label="Resolve" date={dispute.resolveDeadline} met={dispute.status === "resolved"} />
      {dispute.lastResponseClass && <span className={`response-class ${dispute.lastResponseClass}`}>Last reply: {dispute.lastResponseClass}</span>}
      {!dispute.creditorReceivedDate && <label className="inline-date">Creditor received<input type="date" max={todayIso()} onChange={(e) => e.target.value && update.mutate({ id: dispute.id, creditorReceivedDate: e.target.value })} /></label>}
    </div>
    <div className="letter-editor">
      <div className="letter-toolbar">
        <button type="button" className="outline-button" onClick={() => generate.mutate({ disputeId: dispute.id, useAi: aiEnabled })} disabled={generate.isPending}><Sparkles />{generate.isPending ? "Drafting…" : text ? "Redraft" : aiEnabled ? "Draft with AI" : "Generate from template"}</button>
        {text && <button type="button" className="outline-button" onClick={() => saveLetter.mutate({ disputeId: dispute.id, letter: text })} disabled={saveLetter.isPending || letter === null}><Save />Save edits</button>}
        {dispute.letterDraft && <a className="outline-button" href={`/api/files/fcba-letter/${dispute.id}`} target="_blank" rel="noreferrer"><Download />PDF</a>}
        {dispute.letterSource && <small>source: {dispute.letterSource}</small>}
      </div>
      {text ? <textarea value={text} rows={16} onChange={(e) => setLetter(e.target.value)} spellCheck /> : <p className="muted-copy">No letter yet. Drafts are attorney-review work product — they are never sent automatically.</p>}
    </div>
    <div className="response-upload">
      <h4><Send />Log the creditor's reply</h4>
      <FileDrop file={responseFile} onFile={(f, err) => { setResponseFile(f); if (err) onNotice({ tone: "warn", text: err }); }} hint="Upload the letter or email you received" accept=".pdf,image/*,.txt,.eml" />
      <div className="field-grid"><label>Date received<input type="date" value={responseDate} max={todayIso()} onChange={(e) => setResponseDate(e.target.value)} /></label>
        <div className="form-actions"><button className="gold-button" disabled={!responseFile || respond.isPending} onClick={async () => responseFile && respond.mutate({ disputeId: dispute.id, name: responseFile.name, contentBase64: await fileToBase64(responseFile), contentType: responseFile.type || undefined, receivedDate: responseDate })}>{respond.isPending ? "Classifying…" : "File & classify"}</button></div></div>
    </div>
    {(events.data ?? []).length > 0 && <ol className="timeline compact">{events.data!.map((e) => <li key={e.id}><time>{new Date(e.createdAt).toLocaleDateString()}</time><p>{e.message}</p></li>)}</ol>}
  </article>;
}
