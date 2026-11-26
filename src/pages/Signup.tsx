import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Lock, X } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { BRAND } from "@contracts/portal";
import { GoogleButton } from "@/components/GoogleButton";

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$/;

function strength(pw: string) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  return { long: pw.length >= 10, mixed: classes >= 3 };
}

export default function Signup() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const config = trpc.auth.config.useQuery();
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", confirm: "", agree: false });
  const [error, setError] = useState("");
  const uname = form.username.trim().toLowerCase();
  const check = trpc.auth.usernameAvailable.useQuery({ username: uname }, { enabled: USERNAME_RE.test(uname), staleTime: 10_000 });
  const register = trpc.auth.register.useMutation({
    onSuccess: async () => { await utils.auth.me.invalidate(); navigate("/portal/intake"); },
    onError: (e) => setError(e.message),
  });
  const pw = strength(form.password);
  const open = config.data?.registration === true;

  useEffect(() => { if (me.data) navigate("/portal", { replace: true }); }, [me.data, navigate]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirm) return setError("The passwords do not match.");
    if (!form.agree) return setError("Please confirm you understand the workspace is not legal advice.");
    register.mutate({ name: form.name, username: uname, email: form.email, password: form.password });
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <Link to="/" className="brand-lockup"><img src="/reputation-tenability-logo-600.webp" alt="" /><span><strong>REPUTATION TENABILITY</strong><small>CLIENT WORKSPACE</small></span></Link>
        <blockquote>“Informed choices. Accurate reports. Fair treatment.”</blockquote>
        <ul><li>Private, encrypted document storage</li><li>Every finding cites its statute</li><li>Staff-reviewed case organization</li></ul>
      </aside>
      <main className="auth-panel">
        <form onSubmit={submit} className="auth-form" aria-labelledby="signup-title">
          <p className="overline"><Lock aria-hidden="true" />CREATE YOUR ACCOUNT</p>
          <h1 id="signup-title">Start your secure workspace.</h1>
          {config.data && !open ? (
            <>
              <p className="hint">New accounts are currently by invitation from {BRAND.name} staff. If you already have an account, <Link to="/login">sign in</Link>.</p>
              {config.data.google && <GoogleButton intent="signin" label="Sign in with Google" />}
            </>
          ) : (
            <>
              {config.data?.google && <><GoogleButton intent="signup" label="Sign up with Google" /><div className="divider"><span>or create a username</span></div></>}
              <label>Full name<input autoComplete="name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Username
                <input autoComplete="username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, "") })} aria-describedby="uname-hint" />
              </label>
              <small id="uname-hint" className={`field-status ${uname && !USERNAME_RE.test(uname) ? "bad" : check.data?.available === false ? "bad" : check.data?.available ? "good" : ""}`}>
                {!uname ? "3–30 characters: letters, numbers, dots or underscores." : !USERNAME_RE.test(uname) ? "Use 3–30 letters, numbers, dots or underscores; start and end with a letter or number." : check.isFetching ? "Checking…" : check.data?.available ? "✓ Available" : check.data ? "That username is taken." : ""}
              </small>
              <label>Email<input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Password<input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
              <ul className="pw-rules" aria-live="polite">
                <li className={pw.long ? "ok" : ""}>{pw.long ? <Check /> : <X />}At least 10 characters</li>
                <li className={pw.mixed ? "ok" : ""}>{pw.mixed ? <Check /> : <X />}Three of: lowercase, uppercase, numbers, symbols</li>
              </ul>
              <label>Confirm password<input type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
              <label className="check-inline agree"><input type="checkbox" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} />I understand {BRAND.name} provides education and record organization, not legal advice.</label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="gold-button wide" disabled={register.isPending}>{register.isPending ? "Creating your account…" : "Create account"}<ArrowRight /></button>
            </>
          )}
          <p className="switch-line">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>
      </main>
    </div>
  );
}
