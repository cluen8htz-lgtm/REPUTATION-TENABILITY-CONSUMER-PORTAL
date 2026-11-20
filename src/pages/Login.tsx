import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { BRAND } from "@contracts/portal";

function kimiOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  if (!kimiAuthUrl || !appID) return null;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", btoa(redirectUri));
  return url.toString();
}

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const config = trpc.auth.config.useQuery();
  const [params] = useSearchParams();
  const setup = params.has("setup");
  const [mode, setMode] = useState<"signin" | "register">(setup ? "register" : "signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const onDone = async () => { await utils.auth.me.invalidate(); navigate("/portal"); };
  const login = trpc.auth.login.useMutation({ onSuccess: onDone, onError: (e) => setError(e.message) });
  const register = trpc.auth.register.useMutation({ onSuccess: onDone, onError: (e) => setError(e.message) });
  const busy = login.isPending || register.isPending;
  const oauth = config.data?.kimiOAuth ? kimiOAuthUrl() : null;

  useEffect(() => { if (me.data) navigate("/portal", { replace: true }); }, [me.data, navigate]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "signin") login.mutate({ email: form.email, password: form.password });
    else register.mutate(form);
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <Link to="/" className="brand-lockup"><img src="/reputation-tenability-logo.png" alt="" /><span><strong>REPUTATION TENABILITY</strong><small>CLIENT WORKSPACE</small></span></Link>
        <blockquote>“{BRAND.tagline}”</blockquote>
        <ul><li>Statements filed as labeled exhibits</li><li>Every finding cites its statute</li><li>Drafts prepared for attorney review</li></ul>
      </aside>
      <main className="auth-panel">
        <form onSubmit={submit} className="auth-form" aria-labelledby="auth-title">
          <p className="overline"><Lock aria-hidden="true" />SECURE ACCESS</p>
          <h1 id="auth-title">{mode === "signin" ? "Welcome back." : "Create your workspace."}</h1>
          {mode === "register" && <label>Full name<input autoComplete="name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
          <label>Email<input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "register" ? 10 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          {mode === "register" && <small className="hint">At least 10 characters, mixing three of: lowercase, uppercase, numbers, symbols.</small>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="gold-button wide" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}<ArrowRight /></button>
          {(config.data?.registration === true || setup) && <button type="button" className="text-switch" onClick={() => { setMode(mode === "signin" ? "register" : "signin"); setError(""); }}>{mode === "signin" ? "New client? Create an account" : "Already have an account? Sign in"}</button>}
          {config.data?.registration === false && !setup && <p className="hint">New clients receive their sign-in details from Reputation Tenability staff.</p>}
          {oauth && <><div className="divider"><span>or</span></div><a className="outline-button wide" href={oauth}>Continue with Kimi</a></>}
          <p className="legal-note">By continuing you agree that the workspace provides education and organization, not legal advice.</p>
        </form>
      </main>
    </div>
  );
}
