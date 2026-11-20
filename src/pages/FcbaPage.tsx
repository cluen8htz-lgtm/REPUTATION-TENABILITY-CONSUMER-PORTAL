/**
 * FcbaPage.tsx — "Credit Card Billing Error (FCBA)" client portal page.
 *
 * Route: /portal/billing-error
 * Add to App.tsx inside the /portal route:
 *   import FcbaPage from "@/pages/FcbaPage";
 *   <Route path="billing-error" element={<FcbaPage />} />
 * Add "Billing error" to the navigation array in AuthLayout.tsx.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageTitle, EmptyState } from "@/components/PortalComponents";
import { Download, FileText, ShieldAlert, TriangleAlert, Upload } from "lucide-react";

const CATEGORIES = [
  ["statements", "Periodic Statement"],
  ["credit_reports", "Credit Report"],
  ["disputes", "Dispute / Correspondence"],
  ["agreement", "Cardmember Agreement / Credit Document"],
  ["tracking", "Proof of Mailing / Tracking"],
  ["scores", "Score Report / Damages"],
  ["responses", "Creditor Response"],
] as const;

export default function FcbaPage() {
  const qc = useQueryClient();
  const [ack, setAck] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("statements");
  const [isFirst, setIsFirst] = useState(false);
  const [cycle, setCycle] = useState("");

  const statements = useQuery(trpc.fcba.listStatements.queryOptions());
  const violations = useQuery(trpc.fcba.listViolations.queryOptions());
  const disputes = useQuery(trpc.fcba.listDisputes.queryOptions());
  const bundle = useQuery(trpc.fcba.downloadBundle.queryOptions());

  const upload = useMutation({
    ...trpc.fcba.uploadStatement.mutationOptions(),
    onSuccess: (r) => {
      setAck(r.message); // auto-acknowledgment shown to client + logged
      setFile(null);
      qc.invalidateQueries();
      // Immediately queue analysis
      analyze.mutate({ id: r.id });
    },
  });
  const analyze = useMutation(trpc.fcba.analyzeStatement.mutationOptions({
    onSuccess: () => qc.invalidateQueries(),
  }));
  const createDispute = useMutation(trpc.fcba.createDispute.mutationOptions({
    onSuccess: () => qc.invalidateQueries(),
  }));

  const toBase64 = (f: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const doUpload = async () => {
    if (!file) return;
    upload.mutate({
      name: file.name,
      contentBase64: await toBase64(file),
      contentType: file.type || undefined,
      category,
      cycle: cycle || undefined,
      isFirstStatement: isFirst,
    });
  };

  return (
    <div className="fcba-page">
      <PageTitle eyebrow="Fair Credit Billing Act" title="Credit card billing error"
        description="Upload periodic statements. The analyzer marks every violation — red triangles around the credit limit, brackets under transactions — files each document as a labeled exhibit, and drafts your dispute package." />

      {ack && <div className="ack-banner" role="status"><ShieldAlert /> {ack}</div>}

      <Card className="upload-panel">
        <CardHeader><CardTitle><Upload /> Upload a document</CardTitle></CardHeader>
        <CardContent className="upload-grid">
          <Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Billing cycle (e.g. 07/15/25-08/05/25)" value={cycle} onChange={e => setCycle(e.target.value)} />
          <label className="first-stmt"><input type="checkbox" checked={isFirst} onChange={e => setIsFirst(e.target.checked)} /> Initial / first periodic statement</label>
          <Button onClick={doUpload} disabled={!file || upload.isPending}>
            {upload.isPending ? "Filing…" : "Upload & analyze"}
          </Button>
        </CardContent>
      </Card>

      <section className="exhibit-list">
        <h2>Exhibit file (auto-labeled, in order)</h2>
        {statements.data?.length === 0 && <EmptyState title="No exhibits yet" text="Upload your first periodic statement above." />}
        {statements.data?.map(s => (
          <Card key={s.id} className="exhibit-row">
            <CardContent>
              <Badge variant="outline">{s.exhibitLabel}</Badge>
              <span className="folder">{s.folder}</span>
              <strong>{s.fileName}</strong>
              {s.cycle && <span className="cycle">{s.cycle}</span>}
              <span className={`status ${s.analysisStatus}`}>{s.analysisStatus}</span>
              {s.complianceScore !== null && <span className="score">Compliance {s.complianceScore}%</span>}
              <a href={`/api/trpc/fcba.statementUrl?input=${encodeURIComponent(JSON.stringify({ id: s.id }))}`}><FileText size={16} /> Original</a>
              {s.annotatedFileKey && <a href={`/api/trpc/fcba.statementUrl?input=${encodeURIComponent(JSON.stringify({ id: s.id, annotated: true }))}`}><TriangleAlert size={16} /> Annotated (red marks)</a>}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="violation-map">
        <h2>Violation map</h2>
        {violations.data?.length === 0 && <EmptyState title="No violations flagged" text="Upload a statement to begin analysis." />}
        {violations.data?.map(v => (
          <div key={v.id} className={`violation ${v.severity} ${v.mark === "triangle" ? "has-triangle" : ""}`}>
            {v.mark === "triangle" && <span className="red-triangle" aria-label="red triangle violation">🔺</span>}
            <div>
              <Badge className={v.severity}>{v.severity}</Badge> <strong>{v.title}</strong>
              <p className="statute">{v.statute}</p>
              <p>{v.annotation}</p>
              <p className="excerpt">Found: {v.excerpt}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="disputes">
        <h2>Disputes & tracking</h2>
        <Button onClick={() => createDispute.mutate({ creditorName: "CHANGEME", accountLast4: "6109", noticeType: "billing_error" })} disabled={!violations.data?.length}>
          Open billing-error dispute (§1666)
        </Button>
        {disputes.data?.map(d => (
          <Card key={d.id}>
            <CardContent>
              <strong>{d.noticeType.replaceAll("_", " ")}</strong> — {d.creditorName} (****{d.accountLast4})
              <Badge>{d.status}</Badge>
              {d.ackDeadline && <p>Acknowledgment due: {d.ackDeadline.slice(0, 10)} (30 days)</p>}
              {d.resolveDeadline && <p>Resolution due: {d.resolveDeadline.slice(0, 10)} (90 days)</p>}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="bundle">
        <h2>Download the full exhibit bundle</h2>
        <p>Every exhibit, labeled A through Z in filing order, with annotated versions — ready for the arbitration file or your attorney.</p>
        <Button variant="secondary" onClick={() => {
          const blob = new Blob([bundle.data?.manifest ?? ""], { type: "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "FCBA-Exhibit-Bundle-Manifest.txt";
          a.click();
          bundle.data?.files.forEach((f, i) => setTimeout(() => {
            const link = document.createElement("a");
            link.href = f.url;
            link.download = `${String(i + 1).padStart(2, "0")}-${f.exhibit}-${f.name}`;
            link.click();
            if (f.annotatedUrl) setTimeout(() => {
              const l2 = document.createElement("a");
              l2.href = f.annotatedUrl!;
              l2.download = `${String(i + 1).padStart(2, "0")}-${f.exhibit}-ANNOTATED-${f.name}`;
              l2.click();
            }, 400);
          }, i * 800));
        }} disabled={!bundle.data?.files.length}>
          <Download /> Download all statements & exhibits
        </Button>
      </section>
    </div>
  );
}
