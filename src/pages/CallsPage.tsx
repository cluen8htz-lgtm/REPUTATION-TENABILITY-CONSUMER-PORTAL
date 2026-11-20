import { useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, PhoneCall, Plus, Save, ShieldAlert, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle } from "@/components/PortalComponents";

function localDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const initialForm = () => ({
  caseId: "",
  collectorName: "",
  phoneNumber: "",
  calledAt: localDateTime(),
  direction: "incoming" as "incoming" | "outgoing",
  summary: "",
  notes: "",
  consentAcknowledged: false,
});

export default function CallsPage() {
  const utils = trpc.useUtils();
  const callsQuery = trpc.portal.listCalls.useQuery();
  const casesQuery = trpc.portal.listCases.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");

  const createCall = trpc.portal.createCall.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.portal.listCalls.invalidate(), utils.portal.dashboard.invalidate()]);
      setForm(initialForm());
      setShowForm(false);
      setMessage("Call record saved to your private timeline.");
    },
    onError: (error) => setMessage(error.message),
  });

  if (callsQuery.isLoading || casesQuery.isLoading) return <LoadingPanel />;
  const calls = callsQuery.data ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.consentAcknowledged) {
      setMessage("Confirm the recording and consent acknowledgment before saving.");
      return;
    }
    createCall.mutate({
      caseId: form.caseId ? Number(form.caseId) : undefined,
      collectorName: form.collectorName,
      phoneNumber: form.phoneNumber,
      calledAt: form.calledAt,
      direction: form.direction,
      summary: form.summary,
      notes: form.notes,
      consentAcknowledged: true,
    });
  }

  return <>
    <PageTitle eyebrow="COLLECTION CALL LOG" title="Preserve what was said, while it is fresh." description="Build a factual timeline of incoming and outgoing calls. Keep allegations, requests, and your own notes distinct." action={<button className="gold-button" type="button" onClick={() => setShowForm(!showForm)}>{showForm ? <X /> : <Plus />}{showForm ? "Close form" : "Log a call"}</button>} />

    <div className="privacy-strip"><ShieldAlert /><p><strong>No automatic recording.</strong> This release stores your notes only. Recording laws vary by state and circumstance; obtain any required consent before recording or sharing a call.</p></div>
    {message && <p className="form-message" role="status">{message}</p>}

    {showForm && <form className="form-layout inset-form" onSubmit={submit}>
      <section className="form-section"><div><span>01</span><h2>Who called, and when?</h2></div><div className="field-grid">
        <label>Collector or company<input required minLength={2} value={form.collectorName} onChange={(event) => setForm({ ...form, collectorName: event.target.value })} placeholder="Name shown or stated on the call" /></label>
        <label>Phone number<input type="tel" value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} /></label>
        <label>Date and time<input required type="datetime-local" value={form.calledAt} onChange={(event) => setForm({ ...form, calledAt: event.target.value })} /></label>
        <label>Direction<select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as "incoming" | "outgoing" })}><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select></label>
        <label className="field-wide">Related case (optional)<select value={form.caseId} onChange={(event) => setForm({ ...form, caseId: event.target.value })}><option value="">No case selected</option>{(casesQuery.data ?? []).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      </div></section>
      <section className="form-section"><div><span>02</span><h2>What happened?</h2></div><div className="field-grid">
        <label className="field-wide">Factual summary<textarea required minLength={3} rows={5} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Example: Caller identified the company, referenced an account ending in 1234, and requested a payment. I asked for written validation." /></label>
        <label className="field-wide">Private follow-up notes<textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Questions to ask, documents to compare, or items for staff review" /></label>
      </div></section>
      <label className="check-consent"><input type="checkbox" checked={form.consentAcknowledged} onChange={(event) => setForm({ ...form, consentAcknowledged: event.target.checked })} /><span>I understand this form does not record audio, and I will not record or share a call unless consent and applicable law permit it.</span></label>
      <div className="form-actions"><button className="gold-button" disabled={createCall.isPending}><Save />{createCall.isPending ? "Saving…" : "Save call record"}</button></div>
    </form>}

    {calls.length === 0 ? <EmptyState title="No calls logged yet" text="After your next collection call, add the company, time, and a neutral summary while the details are fresh." /> : <div className="call-timeline">{calls.map((item) => {
      const linkedCase = (casesQuery.data ?? []).find((courtCase) => courtCase.id === item.caseId);
      return <article className="call-record" key={item.id}>
        <div className={`call-direction ${item.direction}`}>{item.direction === "incoming" ? <ArrowDownLeft /> : <ArrowUpRight />}</div>
        <div className="call-content"><div className="call-meta"><span>{item.direction === "incoming" ? "INCOMING" : "OUTGOING"}</span><time>{new Date(item.calledAt).toLocaleString()}</time></div><h2>{item.collectorName}</h2><p className="call-number">{item.phoneNumber || "Number not entered"}{linkedCase ? ` · ${linkedCase.title}` : ""}</p><p>{item.summary}</p>{item.notes && <details><summary>Private follow-up notes</summary><p>{item.notes}</p></details>}</div>
      </article>;
    })}</div>}

    <div className="call-tip"><PhoneCall /><div><strong>Keep the original evidence.</strong><p>Save voicemail and caller-ID screenshots in your document cabinet. Do not edit original files; add context in the call log instead.</p></div></div>
  </>;
}
