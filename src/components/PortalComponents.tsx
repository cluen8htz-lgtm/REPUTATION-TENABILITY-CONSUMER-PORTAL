import type { ReactNode } from "react";
import { ArrowRight, Inbox } from "lucide-react";
import { Link } from "react-router";

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-title"><div><p className="overline">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ");
  return <span className={`status-badge status-${status}`}>{label}</span>;
}

export function EmptyState({ title, text, link, linkText }: { title: string; text: string; link?: string; linkText?: string }) {
  return <div className="empty-state"><Inbox aria-hidden="true" /><h2>{title}</h2><p>{text}</p>{link && <Link to={link}>{linkText}<ArrowRight /></Link>}</div>;
}

export function LoadingPanel() {
  return <div className="loading-panel" role="status"><span /><span /><span /><p>Loading your secure workspace…</p></div>;
}
