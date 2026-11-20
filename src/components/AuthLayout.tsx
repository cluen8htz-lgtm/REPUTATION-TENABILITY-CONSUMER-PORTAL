import { type ReactNode, useEffect, useState } from "react";
import { NavLink } from "react-router";
import { BookOpen, BriefcaseBusiness, Car, FileText, LayoutDashboard, LogOut, Menu, PhoneCall, TriangleAlert, UserRound, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { AuthLayoutSkeleton } from "./AuthLayoutSkeleton";

const navigation = [
  { to: "/portal", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/portal/intake", label: "My intake", icon: UserRound },
  { to: "/portal/cases", label: "Court cases", icon: BriefcaseBusiness },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/calls", label: "Call log", icon: PhoneCall },
  { to: "/portal/billing-error", label: "Billing error", icon: TriangleAlert },
  { to: "/portal/repossession", label: "Repossession", icon: Car },
  { to: "/portal/learn", label: "Learn", icon: BookOpen },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setMenuOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (isLoading) return <AuthLayoutSkeleton />;
  if (!user) return null;

  const links = user.role === "admin" ? navigation : navigation;

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <NavLink to="/" className="workspace-brand">
          <img src="/reputation-tenability-logo.png" alt="" />
          <span>REPUTATION<br />TENABILITY</span>
        </NavLink>
        <nav aria-label="Client workspace">
          {links.map((item) => <WorkspaceLink key={item.to} {...item} />)}
          {user.role === "admin" && <NavLink to="/portal/admin" className={({ isActive }) => `workspace-link ${isActive ? "active" : ""}`}><UserRound />Staff review</NavLink>}
        </nav>
        <div className="workspace-account">
          <span className="account-avatar">{user.name?.charAt(0).toUpperCase() ?? "C"}</span>
          <div><strong>{user.name || "Client"}</strong><small>{user.email}</small></div>
          <button type="button" onClick={logout} aria-label="Sign out"><LogOut /></button>
        </div>
      </aside>

      <header className="workspace-mobile-header">
        <NavLink to="/portal" className="workspace-brand"><img src="/reputation-tenability-logo.png" alt="" /><span>REPUTATION TENABILITY</span></NavLink>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button>
      </header>

      {menuOpen && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <div className="mobile-menu-top"><strong>CLIENT WORKSPACE</strong><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X /></button></div>
        <nav aria-label="Mobile client workspace">
          {links.map((item) => <WorkspaceLink key={item.to} {...item} onSelect={() => setMenuOpen(false)} />)}
          {user.role === "admin" && <NavLink to="/portal/admin" onClick={() => setMenuOpen(false)} className="workspace-link"><UserRound />Staff review</NavLink>}
        </nav>
        <button type="button" className="mobile-signout" onClick={logout}><LogOut />Sign out</button>
      </div>

      <main className="workspace-main">{children}</main>
    </div>
  );
}

function WorkspaceLink({ to, label, icon: Icon, end, onSelect }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; onSelect?: () => void }) {
  return <NavLink to={to} end={end} onClick={onSelect} className={({ isActive }) => `workspace-link ${isActive ? "active" : ""}`}><Icon aria-hidden="true" /><span>{label}</span></NavLink>;
}
