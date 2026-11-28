import { AppDownloadCard } from "@/components/AppDownloadCard";
import { ArrowRight, CalendarDays, CalendarPlus, Car, CloudOff, FileCheck2, FolderUp, PhoneCall, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle, StatusBadge } from "@/components/PortalComponents";
import { formatDate } from "@/lib/format";

export default function DashboardPage() {
  const { data, isLoading, error } = trpc.portal.dashboard.useQuery();
  if (isLoading) return <LoadingPanel />;
  if (error) return <div className="error-panel">We could not load your workspace. Refresh the page or contact support.</div>;

  const cases = data?.cases ?? [];
  const documents = data?.documents ?? [];
  const activeCases = cases.filter((item) => item.status !== "closed");
  const reviewed = documents.filter((item) => item.reviewStatus === "reviewed").length;
  const reviewProgress = documents.length ? Math.round((reviewed / documents.length) * 100) : 0;
  const deadlines = data?.deadlines ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return <>
    <PageTitle eyebrow="CLIENT WORKSPACE" title="Your financial record, organized." description="Track case information, preserve source documents, and keep educational guidance separate from staff review." action={<Link className="gold-button" to="/portal/documents">Upload a document<FolderUp /></Link>} />

    {!data?.profile?.intakeCompleted && <Link to="/portal/intake" className="intake-banner"><span><strong>Complete your secure intake.</strong> Tell us which service area and type of help apply to you.</span><ArrowRight /></Link>}

    <section className="dashboard-metrics" aria-label="Workspace summary">
      <div className="progress-ring" style={{ "--progress": `${reviewProgress * 3.6}deg` } as CSSProperties}>
        <div><strong>{reviewProgress}%</strong><span>documents reviewed</span></div>
      </div>
      <div className="metric"><span>OPEN CASES</span><strong>{activeCases.length}</strong><Link to="/portal/cases">Manage cases<ArrowRight /></Link></div>
      <div className="metric"><span>DOCUMENTS</span><strong>{documents.length}</strong><Link to="/portal/documents">Open file cabinet<ArrowRight /></Link></div>
      <div className="metric"><span>CALL RECORDS</span><strong>{data?.calls.length ?? 0}</strong><Link to="/portal/calls">View call log<ArrowRight /></Link></div>
    </section>

    <div className="dashboard-grid">
      <section className="work-section">
        <div className="work-section-heading"><h2>Recent cases</h2><Link to="/portal/cases">View all<ArrowRight /></Link></div>
        {cases.length === 0 ? <EmptyState title="No case records yet" text="Add a case only if you have court paperwork. You can also use the portal for credit or repossession records." link="/portal/cases" linkText="Add a case" /> : <div className="record-list">{cases.slice(0, 3).map((item) => <Link to="/portal/cases" className="case-record" key={item.id}><div><StatusBadge status={item.status} /><h3>{item.title}</h3><p>{item.court || `${item.county} County, ${item.state}`}{item.caseNumber ? ` · ${item.caseNumber}` : ""}</p></div><ArrowRight /></Link>)}</div>}
      </section>

      <aside className="work-section deadline-section">
        <div className="work-section-heading"><h2>Dates to verify</h2><CalendarDays /></div>
        {deadlines.length === 0 ? <p className="muted-copy">No dates yet. Court dates you enter and FCBA clocks from your disputes appear here.</p> : <ul className="deadline-list">{deadlines.slice(0, 6).map((item, index) => <li key={`${item.href}-${index}`} className={item.date.slice(0, 10) < today ? "overdue" : ""}><time>{formatDate(item.date.slice(0, 10))}</time><span><Link to={item.href}><strong>{item.label}</strong></Link><small>{item.context} · {item.verified ? "statutory clock" : "unverified"}</small></span></li>)}</ul>}
        <a className="calendar-link" href="/api/calendar/deadlines.ics"><CalendarPlus />Add to my calendar</a>
        <div className="integration-note"><CloudOff /><div><strong>Docket Alarm not connected</strong><p>Court entries are manual in this release. Live synchronization requires approved API credentials.</p></div></div>
      </aside>
    </div>

    <section className="module-tiles">
      <Link to="/portal/billing-error"><TriangleAlert /><span><strong>Billing error</strong><small>{data?.fcba.exhibits ?? 0} exhibit(s) · {data?.fcba.findings ?? 0} finding(s){data?.fcba.critical ? ` · ${data.fcba.critical} critical` : ""} · {data?.fcba.disputes ?? 0} dispute(s)</small></span><ArrowRight /></Link>
      <Link to="/portal/repossession"><Car /><span><strong>Repossession</strong><small>{data?.repo.cases ?? 0} case(s){data?.repo.cases ? ` · highest issue score ${data.repo.maxRisk}/100` : ""}</small></span><ArrowRight /></Link>
    </section>

    <AppDownloadCard />

    <section className="quick-actions">
      <Link to="/portal/documents"><FileCheck2 /><span><strong>Build your file</strong><small>Statements, reports, mail, and court papers</small></span><ArrowRight /></Link>
      <Link to="/portal/calls"><PhoneCall /><span><strong>Log a collection call</strong><small>Preserve the caller, date, and conversation</small></span><ArrowRight /></Link>
    </section>
  </>;
}
