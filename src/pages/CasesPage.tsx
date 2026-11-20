import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { SERVICE_AREAS } from "@contracts/portal";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle, StatusBadge } from "@/components/PortalComponents";
import { formatDate } from "@/lib/format";

const blankCase = { title: "", plaintiff: "", defendant: "", court: "", state: "FL" as "FL" | "CA", county: "Miami-Dade", caseNumber: "", caseType: "Debt collection", filedOn: "", servedOn: "", nextDeadline: "", deadlineLabel: "", notes: "" };

export default function CasesPage() {
  const utils = trpc.useUtils();
  const casesQuery = trpc.portal.listCases.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankCase);
  const [message, setMessage] = useState("");
  const createCase = trpc.portal.createCase.useMutation({
    onSuccess: async () => { await Promise.all([utils.portal.listCases.invalidate(), utils.portal.dashboard.invalidate()]); setForm(blankCase); setShowForm(false); setMessage("Case record added."); },
    onError: (error) => setMessage(error.message),
  });
  const updateStatus = trpc.portal.updateCaseStatus.useMutation({ onSuccess: () => utils.portal.listCases.invalidate() });

  if (casesQuery.isLoading) return <LoadingPanel />;
  const cases = casesQuery.data ?? [];
  const counties = SERVICE_AREAS.find((area) => area.state === form.state)?.counties ?? [];

  return <>
    <PageTitle eyebrow="COURT CASES" title="A source record for every case." description="Enter information exactly as it appears on court paperwork. Dates remain unverified until reviewed." action={<button className="gold-button" onClick={() => setShowForm(!showForm)}>{showForm ? <X /> : <Plus />}{showForm ? "Close form" : "Add case"}</button>} />
    {message && <p className="form-message" role="status">{message}</p>}
    {showForm && <form className="form-layout inset-form" onSubmit={(event) => { event.preventDefault(); if (!form.title || !form.plaintiff || !form.defendant) { setMessage("Case title, plaintiff, and defendant are required."); return; } createCase.mutate(form); }}>
      <section className="form-section"><div><span>01</span><h2>Case caption</h2></div><div className="field-grid">
        <label className="field-wide">Internal case title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Example: Midland Funding lawsuit" /></label>
        <label>Plaintiff<input value={form.plaintiff} onChange={(e) => setForm({ ...form, plaintiff: e.target.value })} /></label>
        <label>Defendant<input value={form.defendant} onChange={(e) => setForm({ ...form, defendant: e.target.value })} /></label>
        <label>Court<input value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} /></label>
        <label>Case number<input value={form.caseNumber} onChange={(e) => setForm({ ...form, caseNumber: e.target.value })} /></label>
        <label>State<select value={form.state} onChange={(e) => { const state = e.target.value as "FL" | "CA"; setForm({ ...form, state, county: SERVICE_AREAS.find((area) => area.state === state)!.counties[0] }); }}><option value="FL">Florida</option><option value="CA">California</option></select></label>
        <label>County<select value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })}>{counties.map((county) => <option key={county}>{county}</option>)}</select></label>
      </div></section>
      <section className="form-section"><div><span>02</span><h2>Dates from the papers</h2></div><div className="field-grid three-columns">
        <label>Filed date<input type="date" value={form.filedOn} onChange={(e) => setForm({ ...form, filedOn: e.target.value })} /></label>
        <label>Service date<input type="date" value={form.servedOn} onChange={(e) => setForm({ ...form, servedOn: e.target.value })} /></label>
        <label>Date needing review<input type="date" value={form.nextDeadline} onChange={(e) => setForm({ ...form, nextDeadline: e.target.value })} /></label>
        <label className="field-wide">Label for that date<input value={form.deadlineLabel} onChange={(e) => setForm({ ...form, deadlineLabel: e.target.value })} placeholder="Example: Date written on hearing notice" /></label>
        <label className="field-wide">Case notes<textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      </div></section>
      <div className="form-actions"><button className="gold-button" disabled={createCase.isPending}>{createCase.isPending ? "Adding…" : "Add case record"}<ArrowRight /></button></div>
    </form>}

    {cases.length === 0 ? <EmptyState title="Your case list is empty" text="Add court information only when you have the source papers. You can upload those papers next." /> : <div className="case-cards">{cases.map((item) => <article className="case-card" key={item.id}><div className="case-card-top"><StatusBadge status={item.status} /><select aria-label={`Status for ${item.title}`} value={item.status} onChange={(e) => updateStatus.mutate({ id: item.id, status: e.target.value as "needs_review" | "active" | "closed" })}><option value="needs_review">Needs review</option><option value="active">Active</option><option value="closed">Closed</option></select></div><h2>{item.title}</h2><p className="case-caption">{item.plaintiff} v. {item.defendant}</p><dl><div><dt>Court</dt><dd>{item.court || "Not entered"}</dd></div><div><dt>Case number</dt><dd>{item.caseNumber || "Not entered"}</dd></div><div><dt>Filed</dt><dd>{formatDate(item.filedOn)}</dd></div><div><dt>Service</dt><dd>{formatDate(item.servedOn)}</dd></div><div><dt>Date to verify</dt><dd>{formatDate(item.nextDeadline)}</dd></div></dl>{item.notes && <p className="case-notes">{item.notes}</p>}</article>)}</div>}
  </>;
}
