import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PageTitle } from "@/components/PortalComponents";

export default function AccountPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => { setForm({ current: "", next: "", confirm: "" }); setMessage({ ok: true, text: "Password changed." }); },
    onError: (error) => setMessage({ ok: false, text: error.message }),
  });
  const localAccount = user?.unionId?.startsWith("local:");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (form.next !== form.confirm) return setMessage({ ok: false, text: "The new passwords do not match." });
    change.mutate({ current: form.current, next: form.next });
  }
  return <>
    <PageTitle eyebrow="ACCOUNT" title="Your sign-in." description={`Signed in as ${user?.email ?? user?.name ?? "client"}. If staff gave you a temporary password, replace it here.`} />
    {!localAccount ? <p className="muted-copy">This account signs in through an external provider, so there is no password to change here.</p> :
      <form className="form-layout inset-form" onSubmit={submit}>
        <section className="form-section"><div><span>01</span><h2>Change password</h2></div><div className="field-grid">
          <label className="field-wide">Current password<input type="password" autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" required minLength={10} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={10} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
          <small className="field-wide hint">At least 10 characters, mixing three of: lowercase, uppercase, numbers, symbols.</small>
        </div></section>
        {message && <p className={message.ok ? "form-message" : "form-error"} role="status">{message.text}</p>}
        <div className="form-actions"><button className="gold-button" disabled={change.isPending}><KeyRound />{change.isPending ? "Saving…" : "Change password"}</button></div>
      </form>}
  </>;
}
