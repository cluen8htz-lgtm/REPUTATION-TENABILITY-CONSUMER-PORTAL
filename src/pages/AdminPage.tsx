import { useState } from "react";
import { BookPlus, Check, Download, FileCheck2, Play, Users, Video } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle, StatusBadge } from "@/components/PortalComponents";
import { formatDate } from "@/lib/format";

const blankVideo = { title: "", description: "", videoUrl: "", category: "Credit reports", duration: "" };
type AdminTab = "documents" | "videos" | "cases" | "clients";

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const overview = trpc.portal.adminOverview.useQuery(undefined, { enabled: user?.role === "admin" });
  const [tab, setTab] = useState<AdminTab>("documents");
  const [docFilter, setDocFilter] = useState("pending");
  const [summaries, setSummaries] = useState<Record<number, string>>({});
  const [video, setVideo] = useState(blankVideo);
  const [message, setMessage] = useState("");
  const [openingId, setOpeningId] = useState<number | null>(null);

  const review = trpc.portal.adminReviewDocument.useMutation({
    onSuccess: async () => {
      await utils.portal.adminOverview.invalidate();
      setMessage("Document marked reviewed. The summary is now visible in the client’s file cabinet.");
    },
    onError: (error) => setMessage(error.message),
  });
  const addVideo = trpc.portal.adminAddVideo.useMutation({
    onSuccess: async () => {
      await utils.portal.adminOverview.invalidate();
      setVideo(blankVideo);
      setMessage("Video class published to client learning centers.");
    },
    onError: (error) => setMessage(error.message),
  });

  if (authLoading || (user?.role === "admin" && overview.isLoading)) return <LoadingPanel />;
  if (user?.role !== "admin") return <><PageTitle eyebrow="STAFF REVIEW" title="Administrator access required." description="This workspace is restricted to authorized Reputation Tenability staff." /><div className="error-panel">Your current account does not have staff-review permission.</div></>;
  if (overview.error) return <div className="error-panel">Staff records could not be loaded. Please refresh or check the server connection.</div>;

  const data = overview.data ?? { clients: [], cases: [], documents: [], videos: [] };
  const clientsById = new Map(data.clients.map((client) => [client.id, client]));
  const documents = docFilter === "all" ? data.documents : data.documents.filter((item) => item.reviewStatus === docFilter);
  const pendingCount = data.documents.filter((item) => item.reviewStatus === "pending").length;

  async function openDocument(id: number) {
    setOpeningId(id);
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const { url } = await utils.portal.adminDocumentUrl.fetch({ id });
      if (preview) preview.location.href = url;
      else window.location.href = url;
    } catch {
      preview?.close();
      setMessage("Could not open that document. Check storage provisioning and try again.");
    } finally {
      setOpeningId(null);
    }
  }

  return <>
    <PageTitle eyebrow="AUTHORIZED STAFF ONLY" title="Review the source. Clarify the record." description="Open original uploads, write factual client-facing summaries, and publish educational resources. Review does not establish legal conclusions or guarantee an outcome." />

    <section className="admin-metrics" aria-label="Staff overview"><div><span>PENDING REVIEW</span><strong>{pendingCount}</strong></div><div><span>CLIENT ACCOUNTS</span><strong>{data.clients.length}</strong></div><div><span>CASE RECORDS</span><strong>{data.cases.length}</strong></div><div><span>VIDEO CLASSES</span><strong>{data.videos.length}</strong></div></section>
    {message && <p className="form-message" role="status">{message}</p>}

    <div className="admin-tabs" role="tablist" aria-label="Staff records">
      <button role="tab" aria-selected={tab === "documents"} className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}><FileCheck2 />Documents</button>
      <button role="tab" aria-selected={tab === "videos"} className={tab === "videos" ? "active" : ""} onClick={() => setTab("videos")}><Video />Video classes</button>
      <button role="tab" aria-selected={tab === "cases"} className={tab === "cases" ? "active" : ""} onClick={() => setTab("cases")}><BookPlus />Cases</button>
      <button role="tab" aria-selected={tab === "clients"} className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}><Users />Clients</button>
    </div>

    {tab === "documents" && <section className="admin-section">
      <div className="admin-section-heading"><div><h2>Document review queue</h2><p>Summaries should describe the document and organizing steps, not promise an outcome.</p></div><select aria-label="Filter review queue" value={docFilter} onChange={(event) => setDocFilter(event.target.value)}><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="all">All documents</option></select></div>
      {documents.length === 0 ? <EmptyState title="No documents in this view" text="New client uploads will appear here for authorized staff review." /> : <div className="review-list">{documents.map((item) => {
        const owner = clientsById.get(item.userId);
        const summary = summaries[item.id] ?? item.staffSummary ?? "";
        return <article className="review-card" key={item.id}><div className="review-card-heading"><div><StatusBadge status={item.reviewStatus} /><h3>{item.fileName}</h3><p>{owner?.name || owner?.email || `Client #${item.userId}`} · {item.folder} · {formatDate(item.createdAt)}</p></div><button className="outline-button" type="button" onClick={() => openDocument(item.id)} disabled={openingId === item.id}><Download />{openingId === item.id ? "Opening…" : "Open original"}</button></div><label>Client-facing staff summary<textarea rows={4} value={summary} onChange={(event) => setSummaries({ ...summaries, [item.id]: event.target.value })} placeholder="Example: This upload is a periodic billing statement dated… Compare the balance and transactions with the prior statement. No legal deadline has been verified from this document." /></label><div className="review-card-footer"><small>Do not state that accurate information will be removed or that a debt is eliminated.</small><button className="gold-button" type="button" disabled={review.isPending || summary.trim().length < 3} onClick={() => review.mutate({ id: item.id, staffSummary: summary.trim() })}><Check />{review.isPending ? "Saving…" : "Save and mark reviewed"}</button></div></article>;
      })}</div>}
    </section>}

    {tab === "videos" && <section className="admin-section">
      <div className="admin-two-column"><form className="video-publish-form" onSubmit={(event) => { event.preventDefault(); addVideo.mutate({ ...video, duration: video.duration || undefined }); }}><div className="admin-section-heading"><div><h2>Publish a video class</h2><p>Use a reviewed educational link. It becomes visible to all signed-in clients.</p></div><Play /></div><label>Class title<input required minLength={3} value={video.title} onChange={(event) => setVideo({ ...video, title: event.target.value })} /></label><label>Category<input required value={video.category} onChange={(event) => setVideo({ ...video, category: event.target.value })} /></label><label>Video URL<input required type="url" value={video.videoUrl} onChange={(event) => setVideo({ ...video, videoUrl: event.target.value })} placeholder="https://…" /></label><label>Duration<input value={video.duration} onChange={(event) => setVideo({ ...video, duration: event.target.value })} placeholder="Example: 12 minutes" /></label><label>Description<textarea required minLength={10} rows={5} value={video.description} onChange={(event) => setVideo({ ...video, description: event.target.value })} /></label><button className="gold-button" disabled={addVideo.isPending}><Video />{addVideo.isPending ? "Publishing…" : "Publish class"}</button></form>
      <div className="published-videos"><h2>Published library</h2>{data.videos.length === 0 ? <p>No classes have been published yet.</p> : data.videos.map((item) => <article key={item.id}><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p><a href={item.videoUrl} target="_blank" rel="noopener noreferrer">Review source link</a></article>)}</div></div>
    </section>}

    {tab === "cases" && <section className="admin-section"><div className="admin-section-heading"><div><h2>Client-entered case records</h2><p>Dates and allegations are client-supplied until independently reviewed.</p></div></div>{data.cases.length === 0 ? <EmptyState title="No case records" text="Client-entered court records will appear here." /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Client</th><th>Case</th><th>Court / number</th><th>Date to verify</th><th>Status</th></tr></thead><tbody>{data.cases.map((item) => <tr key={item.id}><td>{clientsById.get(item.userId)?.name || `Client #${item.userId}`}</td><td><strong>{item.title}</strong><small>{item.plaintiff} v. {item.defendant}</small></td><td>{item.court || "Not entered"}<small>{item.caseNumber || "No case number"}</small></td><td>{formatDate(item.nextDeadline)}<small>{item.deadlineLabel || "Unverified entry"}</small></td><td><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div>}</section>}

    {tab === "clients" && <section className="admin-section"><div className="admin-section-heading"><div><h2>Client accounts</h2><p>Authorized staff access only. Do not export or reuse client information for unsolicited marketing.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Client</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>{data.clients.map((client) => <tr key={client.id}><td><strong>{client.name || "Unnamed client"}</strong></td><td>{client.email || "Not provided"}</td><td>{client.role}</td><td>{formatDate(client.createdAt)}</td></tr>)}</tbody></table></div></section>}
  </>;
}
