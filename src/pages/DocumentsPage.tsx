import { useMemo, useRef, useState } from "react";
import { Camera, Download, FileText, Folder, Trash2, Upload, X } from "lucide-react";
import { DOCUMENT_CATEGORIES } from "@contracts/portal";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle, StatusBadge } from "@/components/PortalComponents";
import { formatDate } from "@/lib/format";

const MAX_FILE_SIZE = 6_000_000;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
}

export default function DocumentsPage() {
  const utils = trpc.useUtils();
  const documentsQuery = trpc.portal.listDocuments.useQuery();
  const casesQuery = trpc.portal.listCases.useQuery();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0].value);
  const [caseId, setCaseId] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [openingId, setOpeningId] = useState<number | null>(null);

  const upload = trpc.portal.uploadDocument.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.portal.listDocuments.invalidate(), utils.portal.dashboard.invalidate()]);
      setSelectedFile(null);
      setCaseId("");
      setShowUpload(false);
      setMessage("Document preserved in your private file cabinet and queued for staff review.");
    },
    onError: (error) => setMessage(error.message),
  });
  const remove = trpc.portal.removeDocument.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.portal.listDocuments.invalidate(), utils.portal.dashboard.invalidate()]);
      setMessage("Document deleted.");
    },
    onError: (error) => setMessage(error.message),
  });

  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const folders = useMemo(() => Array.from(new Set(documents.map((item) => item.folder))), [documents]);
  const visibleDocuments = folderFilter === "all" ? documents : documents.filter((item) => item.folder === folderFilter);

  if (documentsQuery.isLoading || casesQuery.isLoading) return <LoadingPanel />;

  function chooseFile(file?: File) {
    setMessage("");
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setMessage("That file is larger than 6 MB. Please upload a smaller copy in this release.");
      return;
    }
    setSelectedFile(file);
    setShowUpload(true);
  }

  async function submitUpload() {
    if (!selectedFile) {
      setMessage("Choose a document or take a photo first.");
      return;
    }
    setMessage("Encrypting the transfer and preserving your original file…");
    try {
      const contentBase64 = await toBase64(selectedFile);
      await upload.mutateAsync({
        name: selectedFile.name,
        contentBase64,
        contentType: selectedFile.type || "application/octet-stream",
        category,
        caseId: caseId ? Number(caseId) : undefined,
      });
    } catch {
      // The mutation's error handler displays the server or conversion failure.
    }
  }

  async function openDocument(id: number) {
    setOpeningId(id);
    setMessage("");
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const { url } = await utils.portal.documentUrl.fetch({ id });
      if (preview) preview.location.href = url;
      else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
      }
    } catch {
      preview?.close();
      setMessage("The secure download link could not be created. Please try again.");
    } finally {
      setOpeningId(null);
    }
  }

  return <>
    <PageTitle
      eyebrow="PRIVATE FILE CABINET"
      title="Every paper. One source of truth."
      description="Upload original court papers, statements, reports, letters, and payment records. Staff classification and explanations appear here after review."
      action={<button className="gold-button" type="button" onClick={() => setShowUpload(!showUpload)}>{showUpload ? <X /> : <Upload />}{showUpload ? "Close upload" : "Add document"}</button>}
    />

    <div className="privacy-strip"><FileText /><p><strong>Originals are preserved.</strong> Files are private to your account and authorized staff. Uploading does not calculate a legal deadline or guarantee a dispute outcome.</p></div>
    {message && <p className="form-message" role="status">{message}</p>}

    {showUpload && <section className="upload-panel" aria-label="Upload a document">
      <div className="upload-sources">
        <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,image/*,.txt,.doc,.docx,.xls,.xlsx" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
        <input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" onClick={() => fileInput.current?.click()}><Upload /><span><strong>Choose a file</strong><small>PDF, image, Office document, or text · up to 6 MB</small></span></button>
        <button type="button" onClick={() => cameraInput.current?.click()}><Camera /><span><strong>Use phone camera</strong><small>Photograph mail or paper documents</small></span></button>
      </div>
      <div className="upload-details">
        <div className="selected-file">{selectedFile ? <><FileText /><span><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)} · ready to upload</small></span></> : <p>No file selected yet.</p>}</div>
        <div className="field-grid">
          <label>Document type<select value={category} onChange={(event) => setCategory(event.target.value)}>{DOCUMENT_CATEGORIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          <label>Related case (optional)<select value={caseId} onChange={(event) => setCaseId(event.target.value)}><option value="">No case selected</option>{(casesQuery.data ?? []).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        </div>
        <button className="gold-button" type="button" disabled={upload.isPending || !selectedFile} onClick={submitUpload}><Upload />{upload.isPending ? "Uploading…" : "Upload to my file"}</button>
      </div>
      <p className="upload-note">Camera scanning opens your device camera. Automatic OCR and document interpretation are not active in this release; staff review remains a separate step.</p>
    </section>}

    {documents.length > 0 && <div className="folder-tabs" role="group" aria-label="Filter documents by folder">
      <button type="button" className={folderFilter === "all" ? "active" : ""} onClick={() => setFolderFilter("all")}>All files <span>{documents.length}</span></button>
      {folders.map((folder) => <button type="button" className={folderFilter === folder ? "active" : ""} onClick={() => setFolderFilter(folder)} key={folder}>{folder}<span>{documents.filter((item) => item.folder === folder).length}</span></button>)}
    </div>}

    {documents.length === 0 ? <EmptyState title="Your file cabinet is ready" text="Add your first source document. You can photograph a paper statement or choose an existing PDF." /> : visibleDocuments.length === 0 ? <EmptyState title="No documents in this folder" text="Choose another folder or upload a document with this classification." /> : <div className="document-list">
      {visibleDocuments.map((item) => <article className="document-row" key={item.id}>
        <div className="document-icon"><FileText /></div>
        <div className="document-main"><div className="document-labels"><StatusBadge status={item.reviewStatus} /><span><Folder />{item.folder}</span></div><h2>{item.fileName}</h2><p>{formatBytes(item.size)} · Added {formatDate(item.createdAt)}{item.contentType ? ` · ${item.contentType}` : ""}</p>{item.staffSummary && <div className="staff-summary"><strong>STAFF REVIEW</strong><p>{item.staffSummary}</p></div>}</div>
        <div className="document-actions"><button type="button" onClick={() => openDocument(item.id)} disabled={openingId === item.id}><Download />{openingId === item.id ? "Opening…" : "Open"}</button><button type="button" className="danger-action" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete “${item.fileName}”? This cannot be undone.`)) remove.mutate({ id: item.id }); }} aria-label={`Delete ${item.fileName}`}><Trash2 /></button></div>
      </article>)}
    </div>}
  </>;
}
