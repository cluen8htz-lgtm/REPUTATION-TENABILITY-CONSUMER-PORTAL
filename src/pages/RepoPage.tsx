/**
 * RepoPage.tsx — Self-help repossession workspace. Route: /portal/repossession
 *
 * Case list → case workspace: exhibits, screening questionnaire with live
 * REPO-001…008 preview (optionally pre-filled by AI from the notices),
 * redemption window, missing-evidence checklist, drafts, ZIP bundle.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, Car, Download, FileText, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle, StatusBadge } from "@/components/PortalComponents";
import { FileDrop, Notice, ScoreGauge, SeverityBadge, Steps, Tabs } from "@/components/ModuleKit";
import { fileToBase64, todayIso } from "@/lib/files";
import { EMPTY_REPO_FACTS, evaluateRepo, repoRiskScore, type RepoFacts } from "@contracts/repo-engine";

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: "Retail installment contract", notice_611: "Notice of intent / §9-611", notice_613: "Disposition notice / §9-613", notice_616: "Deficiency explanation / §9-616",
  default_notice: "Default / right-to-cure notice", notice_of_sale: "Notice of sale", ucc1: "UCC-1 financing statement", prospectus_424b5: "424B5 prospectus",
  report_10k: "10-K annual report", report_8k: "8-K current report", sales_servicing_agreement: "Sale & Servicing Agreement", pacer_case: "PACER case file",
  dmv_title: "DMV title record", repo_work_order: "Repo agency work order", other: "Other",
};
const DRAFTS = [
  { value: "document_demand", label: "Document demand", help: "Certified-mail demand for the full Article 9 file (send first)." },
  { value: "sec_due_diligence", label: "SEC due-diligence plan", help: "424B5 → 10-K → 8-K → UCC-1 → Sale & Servicing Agreement." },
  { value: "notice_of_demand", label: "Notice of demand", help: "Findings, demand, and 30-day response window." },
  { value: "special_report", label: "Special report", help: "Securitization & authority analysis with exhibit map." },
  { value: "federal_complaint", label: "Federal complaint skeleton", help: "Wright v. Santander structure, caption placeholders." },
] as const;
type DraftType = (typeof DRAFTS)[number]["value"];

export default function RepoPage() {
  const cases = trpc.repo.listCases.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  if (cases.isLoading) return <LoadingPanel />;
  if (openId) return <CaseWorkspace id={openId} onBack={() => setOpenId(null)} />;
  const list = cases.data ?? [];
  return <div className="module-page">
    <PageTitle eyebrow="SELF-HELP REPOSSESSION · FL & CA" title="Repossession review" description="Organize the contract, every Article 9 notice, the title and UCC record, and the trust's SEC filings. The screening engine flags notice, redemption, breach-of-peace, deficiency, and authority issues for attorney review." action={<button className="gold-button" onClick={() => setShowNew(!showNew)}><Plus />{showNew ? "Close" : "Open a case"}</button>} />
    {showNew && <NewCaseForm onCreated={(id) => { setShowNew(false); cases.refetch(); setOpenId(id); }} />}
    {list.length === 0 && !showNew ? <EmptyState title="No repossession cases" text="Open a case for each vehicle. You can add documents and answer the questionnaire at your own pace." /> :
      <div className="case-cards">{list.map((k) => <button type="button" key={k.id} className="case-card repo-card" onClick={() => setOpenId(k.id)}>
        <div className="case-card-top"><StatusBadge status={k.status} /><ScoreGauge value={k.riskScore} label="issue score" invert /></div>
        <h2><Car />{k.vehicle}</h2><p className="case-caption">{k.creditorName}{k.repoAgencyName ? ` · ${k.repoAgencyName}` : ""} · {k.state}</p>
        <dl><div><dt>Repossessed</dt><dd>{k.repossessionDate ?? "—"}</dd></div><div><dt>Sale</dt><dd>{k.saleDate ?? "—"}</dd></div></dl>
      </button>)}</div>}
  </div>;
}

function NewCaseForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ creditorName: "", repoAgencyName: "", vehicle: "", vin: "", state: "FL" as "FL" | "CA", repossessionDate: "", saleDate: "", rcSignDate: "" });
  const open = trpc.repo.openCase.useMutation({ onSuccess: (r) => onCreated(r.id) });
  const opt = (v: string) => v || undefined;
  return <form className="form-layout inset-form" onSubmit={(e) => { e.preventDefault(); open.mutate({ ...form, repoAgencyName: opt(form.repoAgencyName), vin: opt(form.vin), repossessionDate: opt(form.repossessionDate), saleDate: opt(form.saleDate), rcSignDate: opt(form.rcSignDate) }); }}>
    <section className="form-section"><div><span>01</span><h2>Parties & vehicle</h2></div><div className="field-grid">
      <label>Creditor / servicer<input required value={form.creditorName} onChange={(e) => setForm({ ...form, creditorName: e.target.value })} /></label>
      <label>Repossession agency<input value={form.repoAgencyName} onChange={(e) => setForm({ ...form, repoAgencyName: e.target.value })} /></label>
      <label>Vehicle (year, make, model)<input required value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} /></label>
      <label>VIN<input maxLength={17} value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value.toUpperCase() })} /></label>
      <label>State<select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value as "FL" | "CA" })}><option value="FL">Florida</option><option value="CA">California</option></select></label>
    </div></section>
    <section className="form-section"><div><span>02</span><h2>Key dates</h2></div><div className="field-grid three-columns">
      <label>Contract signed<input type="date" value={form.rcSignDate} onChange={(e) => setForm({ ...form, rcSignDate: e.target.value })} /></label>
      <label>Repossessed<input type="date" value={form.repossessionDate} onChange={(e) => setForm({ ...form, repossessionDate: e.target.value })} /></label>
      <label>Sale / disposition<input type="date" value={form.saleDate} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} /></label>
    </div></section>
    {open.error && <p className="form-message">{open.error.message}</p>}
    <div className="form-actions"><button className="gold-button" disabled={open.isPending}>{open.isPending ? "Opening…" : "Open case"}</button></div>
  </form>;
}

type Tab = "screen" | "exhibits" | "drafts";

function CaseWorkspace({ id, onBack }: { id: number; onBack: () => void }) {
  const detail = trpc.repo.caseDetail.useQuery({ id });
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("screen");
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warn"; text: string } | null>(null);
  const refresh = () => Promise.all([utils.repo.caseDetail.invalidate({ id }), utils.repo.listCases.invalidate()]);
  if (detail.isLoading || !detail.data) return <LoadingPanel />;
  const d = detail.data;
  const step = d.drafts.length ? 3 : d.violations.length ? 2 : d.documents.length ? 1 : 0;
  return <div className="module-page">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft />All repossession cases</button>
    <PageTitle eyebrow={`${d.case.state} · ${d.case.creditorName.toUpperCase()}`} title={d.case.vehicle} description={`${d.case.vin ? `VIN ${d.case.vin} · ` : ""}Repossessed ${d.case.repossessionDate ?? "date unknown"} · Sale ${d.case.saleDate ?? "date unknown"}`} action={<a className="gold-button" href={`/api/bundles/repo/${id}`}><Download />Case bundle (.zip)</a>} />
    <Steps steps={["Gather exhibits", "Answer questionnaire", "Review indicators", "Draft"]} current={step} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    <section className="module-summary">
      <ScoreGauge value={d.case.riskScore} label="issue score" invert />
      <div className="metric"><span>REDEMPTION</span><strong>{d.redemption.daysLeft ?? "—"}</strong><small>{d.redemption.message}</small></div>
      <div className="metric"><span>EXHIBITS</span><strong>{d.documents.length}</strong><small>{d.missing.length} item(s) still to gather</small></div>
      <div className="metric"><span>INDICATORS</span><strong>{d.violations.length}</strong><small>{d.violations.filter((v) => v.severity === "critical").length} critical</small></div>
    </section>
    <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "screen", label: "Screening", count: d.violations.length }, { value: "exhibits", label: "Exhibits", count: d.documents.length }, { value: "drafts", label: "Drafts", count: d.drafts.length }]} />
    {tab === "screen" && <Screening caseId={id} initial={d.facts} hasDocs={d.documents.length > 0} saved={d.violations} onNotice={setNotice} onSaved={refresh} />}
    {tab === "exhibits" && <Exhibits caseId={id} docs={d.documents} missing={d.missing} onNotice={setNotice} onChanged={refresh} />}
    {tab === "drafts" && <Drafts caseId={id} drafts={d.drafts} onNotice={setNotice} onChanged={refresh} />}
    <section className="work-section timeline-section"><div className="work-section-heading"><h2>Activity</h2></div>
      <ol className="timeline">{d.events.map((e) => <li key={e.id}><time>{new Date(e.createdAt).toLocaleString()}</time><p>{e.message}</p></li>)}</ol></section>
  </div>;
}

type Tri = "yes" | "no" | "unknown";
function TriSelect({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return <label>{label}<select value={value} onChange={(e) => onChange(e.target.value as Tri)}><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>;
}

function Screening({ caseId, initial, hasDocs, saved, onNotice, onSaved }: { caseId: number; initial: RepoFacts; hasDocs: boolean; saved: Array<{ id: number; ruleId: string; title: string; statute: string; severity: string; excerpt: string; annotation: string }>; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void; onSaved: () => void }) {
  const [facts, setFacts] = useState<RepoFacts>({ ...EMPTY_REPO_FACTS, ...initial });
  const preview = useMemo(() => evaluateRepo(facts), [facts]);
  const save = trpc.repo.saveFacts.useMutation({ onSuccess: (r) => { onNotice({ tone: "success", text: `Screening saved: ${r.hits.length} indicator(s), issue score ${r.riskScore}/100.` }); onSaved(); } });
  const suggest = trpc.repo.suggestFacts.useMutation({ onSuccess: (r) => { if (r.facts) setFacts({ ...facts, ...r.facts }); onNotice({ tone: r.facts ? "info" : "warn", text: r.notice }); } });
  const set = <K extends keyof RepoFacts>(key: K, value: RepoFacts[K]) => setFacts({ ...facts, [key]: value });
  const bop = facts.breachOfPeace;
  const text = (key: "noticeSenderName" | "securedPartyOfRecord" | "trustName" | "dmvLienholder", label: string) => <label>{label}<input value={facts[key] ?? ""} onChange={(e) => set(key, e.target.value || null)} /></label>;
  const date = (key: "repossessionDate" | "saleDate" | "noticeDate" | "receivableSoldToTrustDate", label: string) => <label>{label}<input type="date" value={facts[key] ?? ""} onChange={(e) => set(key, e.target.value || null)} /></label>;
  const num = (key: "salePrice" | "estimatedValue", label: string) => <label>{label}<input type="number" min={0} step="1" value={facts[key] ?? ""} onChange={(e) => set(key, e.target.value === "" ? null : Number(e.target.value))} /></label>;
  return <div className="facts-body inline">
    <form onSubmit={(e) => { e.preventDefault(); save.mutate({ caseId, facts }); }}>
      {hasDocs && <div className="form-actions start"><button type="button" className="outline-button" onClick={() => suggest.mutate({ caseId })} disabled={suggest.isPending}><Sparkles />{suggest.isPending ? "Reading exhibits…" : "Pre-fill from my documents"}</button></div>}
      <fieldset><legend>Dates</legend><div className="field-grid">
        <label>State<select value={facts.state} onChange={(e) => set("state", e.target.value as "FL" | "CA")}><option value="FL">Florida</option><option value="CA">California</option></select></label>
        {date("repossessionDate", "Repossession date")}{date("saleDate", "Sale / disposition date")}{date("noticeDate", "Date on the sale notice")}
      </div></fieldset>
      <fieldset><legend>Notices</legend><div className="field-grid">
        <TriSelect label="Did you receive a notice before the sale?" value={facts.noticeOfSaleReceived} onChange={(v) => set("noticeOfSaleReceived", v)} />
        <TriSelect label="Did it give the time & place (public) or date (private sale)?" value={facts.noticeStatesTimePlaceOrMethod} onChange={(v) => set("noticeStatesTimePlaceOrMethod", v)} />
        <TriSelect label="Did it name the secured party?" value={facts.noticeIdentifiesSecuredParty} onChange={(v) => set("noticeIdentifiesSecuredParty", v)} />
        {text("noticeSenderName", "Who sent the notice")}
      </div></fieldset>
      <fieldset><legend>Ownership & securitization</legend><div className="field-grid">
        {text("securedPartyOfRecord", "Secured party of record (title / UCC-1)")}{text("dmvLienholder", "Lienholder on DMV title")}
        {text("trustName", "Securitization trust (from SEC filings)")}{date("receivableSoldToTrustDate", "Date receivable sold to trust")}
      </div></fieldset>
      <fieldset><legend>The repossession</legend><div className="check-grid">
        {([["objectedAtScene", "I objected at the scene"], ["enteredClosedGarageOrGate", "They entered a closed garage or gate"], ["threatsOrConfrontation", "There were threats or a confrontation"], ["policeAssistedWithoutCourtOrder", "Police helped without a court order"]] as const).map(([key, label]) =>
          <label key={key} className="check-inline"><input type="checkbox" checked={bop[key]} onChange={(e) => set("breachOfPeace", { ...bop, [key]: e.target.checked })} />{label}</label>)}
        <label className="check-inline"><input type="checkbox" checked={facts.repoAgentMisrepresentation} onChange={(e) => set("repoAgentMisrepresentation", e.target.checked)} />The agent lied about or threatened its right to take the car</label>
      </div></fieldset>
      <fieldset><legend>Sale & deficiency</legend><div className="field-grid">
        <label>Sale type<select value={facts.saleType} onChange={(e) => set("saleType", e.target.value as RepoFacts["saleType"])}><option value="unknown">Not sure</option><option value="public">Public auction</option><option value="private">Private sale</option></select></label>
        {num("salePrice", "Sale price ($)")}{num("estimatedValue", "Estimated value ($, e.g. book value)")}
        <TriSelect label="Are they demanding a deficiency?" value={facts.deficiencyDemanded} onChange={(v) => set("deficiencyDemanded", v)} />
        <TriSelect label="Did you get a written explanation of the deficiency?" value={facts.deficiencyExplanationReceived} onChange={(v) => set("deficiencyExplanationReceived", v)} />
      </div></fieldset>
      <div className="form-actions"><button className="gold-button" disabled={save.isPending}><Save />{save.isPending ? "Screening…" : "Save & run screening"}</button></div>
    </form>
    <aside className="live-preview" aria-live="polite">
      <ScoreGauge value={repoRiskScore(preview)} label="live issue score" invert />
      <ul>{preview.length === 0 ? <li className="muted-copy">No indicators on these answers yet.</li> : preview.map((h) => <li key={h.ruleId}><div><strong>{h.ruleId} · {h.title}</strong><small>{h.excerpt}</small><small className="statute">{h.statute}</small></div><SeverityBadge severity={h.severity} /></li>)}</ul>
      {saved.length > 0 && <p className="muted-copy">{saved.length} indicator(s) saved on this case. Save again after changing answers.</p>}
      <p className="disclaimer">Screening indicators are issues to investigate with an attorney — not conclusions that the repossession was unlawful.</p>
    </aside>
  </div>;
}

function Exhibits({ caseId, docs, missing, onNotice, onChanged }: { caseId: number; docs: Array<{ id: number; exhibitLabel: string; fileName: string; docType: string; createdAt: Date }>; missing: string[]; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("contract");
  const upload = trpc.repo.uploadDocument.useMutation({ onSuccess: (r) => { setFile(null); onNotice({ tone: "success", text: r.message }); onChanged(); }, onError: (e) => onNotice({ tone: "warn", text: e.message }) });
  const remove = trpc.repo.removeDocument.useMutation({ onSuccess: onChanged });
  return <div className="split-grid">
    <div>
      <section className="upload-panel module-upload">
        <FileDrop file={file} onFile={(f, err) => { setFile(f); if (err) onNotice({ tone: "warn", text: err }); }} hint="PDF, photo, or text · up to 15 MB" accept=".pdf,image/*,.txt" capture />
        <div className="field-grid"><label>Document type<select value={docType} onChange={(e) => setDocType(e.target.value)}>{Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <div className="form-actions"><button className="gold-button" disabled={!file || upload.isPending} onClick={async () => file && upload.mutate({ caseId, name: file.name, contentBase64: await fileToBase64(file), contentType: file.type || undefined, docType: docType as "contract" })}><Upload />{upload.isPending ? "Filing…" : "File exhibit"}</button></div></div>
      </section>
      {docs.length === 0 ? <EmptyState title="No exhibits yet" text="Start with the contract and every notice you received after the repossession." /> :
        <div className="exhibit-table">{docs.map((d) => <div className="exhibit-row" key={d.id}><span className="exhibit-label">{d.exhibitLabel.replace("Exhibit ", "")}</span><div className="exhibit-main"><strong>{d.fileName}</strong><small>{DOC_TYPE_LABELS[d.docType] ?? d.docType} · filed {new Date(d.createdAt).toLocaleDateString()}</small></div>
          <div className="row-actions"><a href={`/api/files/repo/${d.id}`} target="_blank" rel="noreferrer"><FileText />Open</a><button type="button" className="danger" onClick={() => { if (confirm(`Remove ${d.exhibitLabel}?`)) remove.mutate({ id: d.id }); }}><Trash2 /></button></div></div>)}</div>}
    </div>
    <aside className="work-section checklist"><div className="work-section-heading"><h2>Still to gather</h2></div>
      {missing.length === 0 ? <p className="muted-copy">The core file is complete.</p> : <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      <p className="muted-copy">SEC filings for auto-receivables trusts are free on EDGAR. The document demand draft asks the creditor and agency for the rest.</p>
    </aside>
  </div>;
}

function Drafts({ caseId, drafts, onNotice, onChanged }: { caseId: number; drafts: Array<{ id: number; draftType: string; body: string; source: string; updatedAt: Date }>; onNotice: (n: { tone: "info" | "success" | "warn"; text: string }) => void; onChanged: () => void }) {
  const config = trpc.auth.config.useQuery();
  const [sendTo, setSendTo] = useState<"creditor" | "repo_agency" | "both">("both");
  const [selected, setSelected] = useState<number | null>(drafts[0]?.id ?? null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const generate = trpc.repo.generateDraft.useMutation({ onSuccess: (r) => { setSelected(r.id); onNotice(r.notice ? { tone: "warn", text: r.notice } : { tone: "success", text: `Draft ready (${r.source}). Review before use.` }); onChanged(); } });
  const save = trpc.repo.saveDraft.useMutation({ onSuccess: () => { onNotice({ tone: "success", text: "Draft saved." }); onChanged(); } });
  const current = drafts.find((d) => d.id === selected) ?? drafts[0];
  return <div className="split-grid">
    <aside className="draft-menu">
      <label>Address demands to<select value={sendTo} onChange={(e) => setSendTo(e.target.value as typeof sendTo)}><option value="both">Creditor and repo agency</option><option value="creditor">Creditor only</option><option value="repo_agency">Repo agency only</option></select></label>
      {DRAFTS.map((d) => <button type="button" key={d.value} className="draft-option" disabled={generate.isPending} onClick={() => generate.mutate({ caseId, draftType: d.value as DraftType, sendTo, useAi: Boolean(config.data?.ai) })}><strong>{d.label}</strong><small>{d.help}</small></button>)}
      {generate.isPending && <p className="muted-copy">Drafting…</p>}
      {drafts.length > 0 && <><h4>Saved drafts</h4>{drafts.map((d) => <button type="button" key={d.id} className={`saved-draft ${current?.id === d.id ? "active" : ""}`} onClick={() => setSelected(d.id)}>{d.draftType.replaceAll("_", " ")}<small>{d.source} · {new Date(d.updatedAt).toLocaleDateString()}</small></button>)}</>}
    </aside>
    <div className="letter-editor">
      {!current ? <EmptyState title="No drafts yet" text="Start with the document demand — it requests everything the screening needs." /> : <>
        <div className="letter-toolbar"><strong>{current.draftType.replaceAll("_", " ")}</strong>
          <button type="button" className="outline-button" disabled={edits[current.id] === undefined || save.isPending} onClick={() => save.mutate({ id: current.id, body: edits[current.id] })}><Save />Save edits</button>
          <a className="outline-button" href={`/api/files/repo-draft/${current.id}`} target="_blank" rel="noreferrer"><Download />PDF</a></div>
        <textarea rows={28} value={edits[current.id] ?? current.body} onChange={(e) => setEdits({ ...edits, [current.id]: e.target.value })} spellCheck />
        <p className="disclaimer">Attorney-review work product generated {todayIso()}. Not legal advice; never filed or sent automatically.</p>
      </>}
    </div>
  </div>;
}
