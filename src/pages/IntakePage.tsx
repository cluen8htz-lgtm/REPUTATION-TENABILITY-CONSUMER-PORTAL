import { useState } from "react";
import { Check, Save } from "lucide-react";
import { useNavigate } from "react-router";
import { SERVICE_AREAS, SERVICE_INTERESTS } from "@contracts/portal";
import { trpc } from "@/providers/trpc";
import { LoadingPanel, PageTitle } from "@/components/PortalComponents";

type IntakeProfile = {
  phone: string | null;
  state: string | null;
  county: string | null;
  serviceInterest: string | null;
  contactPreference: string | null;
  intakeNotes: string | null;
};

type ContactPreference = "Email" | "Phone" | "Text" | "Secure message";

export default function IntakePage() {
  const { data, isLoading, error } = trpc.portal.dashboard.useQuery();
  if (isLoading) return <LoadingPanel />;
  if (error) return <div className="error-panel">Your intake could not be loaded. Refresh the page or contact support.</div>;
  return <IntakeForm profile={data?.profile} />;
}

function IntakeForm({ profile }: { profile?: IntakeProfile | null }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [form, setForm] = useState(() => ({
    phone: profile?.phone ?? "",
    state: (profile?.state === "CA" ? "CA" : "FL") as "FL" | "CA",
    county: profile?.county || "Miami-Dade",
    serviceInterest: profile?.serviceInterest || SERVICE_INTERESTS[0] as string,
    contactPreference: (["Email", "Phone", "Text", "Secure message"].includes(profile?.contactPreference ?? "") ? profile?.contactPreference : "Secure message") as ContactPreference,
    intakeNotes: profile?.intakeNotes ?? "",
  }));
  const [message, setMessage] = useState("");
  const saveIntake = trpc.portal.saveIntake.useMutation({
    onSuccess: async (_, variables) => {
      await utils.portal.dashboard.invalidate();
      if (variables.intakeCompleted) navigate("/portal");
      else setMessage("Draft saved securely. Return whenever you are ready.");
    },
    onError: (error) => setMessage(error.message),
  });

  const counties = SERVICE_AREAS.find((area) => area.state === form.state)?.counties ?? [];

  function save(intakeCompleted: boolean) {
    setMessage("");
    saveIntake.mutate({ ...form, intakeCompleted });
  }

  return <>
    <PageTitle eyebrow="SECURE INTAKE" title="Tell us what brings you here." description="Start with what you know. You can save a draft and add source documents later. Do not enter a full Social Security number." />
    <form className="form-layout" onSubmit={(event) => { event.preventDefault(); save(true); }}>
      <section className="form-section"><div><span>01</span><h2>Contact and location</h2></div><div className="field-grid">
        <label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" autoComplete="tel" /></label>
        <label>Preferred contact<select value={form.contactPreference} onChange={(e) => setForm({ ...form, contactPreference: e.target.value as ContactPreference })}><option>Secure message</option><option>Email</option><option>Phone</option><option>Text</option></select></label>
        <label>State<select value={form.state} onChange={(e) => { const state = e.target.value as "FL" | "CA"; setForm({ ...form, state, county: SERVICE_AREAS.find((area) => area.state === state)!.counties[0] }); }}><option value="FL">Florida</option><option value="CA">California</option></select></label>
        <label>County<select value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })}>{counties.map((county) => <option key={county}>{county}</option>)}</select></label>
      </div></section>
      <section className="form-section"><div><span>02</span><h2>Type of assistance</h2></div><div className="field-grid">
        <label className="field-wide">Primary concern<select value={form.serviceInterest} onChange={(e) => setForm({ ...form, serviceInterest: e.target.value })}>{SERVICE_INTERESTS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field-wide">What happened?<textarea value={form.intakeNotes} onChange={(e) => setForm({ ...form, intakeNotes: e.target.value })} rows={7} placeholder="List the companies involved, documents you received, and any dates you want staff to review. Do not guess at legal deadlines." /></label>
      </div></section>
      <div className="form-consent"><p>Submitting this form does not create an attorney-client relationship or guarantee services or outcomes. Court deadlines must be verified independently.</p></div>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="form-actions"><button type="button" className="outline-button" disabled={saveIntake.isPending} onClick={() => save(false)}><Save />Save draft</button><button type="submit" className="gold-button" disabled={saveIntake.isPending}><Check />{saveIntake.isPending ? "Saving…" : "Complete intake"}</button></div>
    </form>
  </>;
}
