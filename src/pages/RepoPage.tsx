/**
 * RepoPage.tsx — "Repossession" client portal page.
 * Route: /portal/repossession — add inside the /portal route in App.tsx,
 * and add { to: "/portal/repossession", label: "Repossession", icon: Car } to AuthLayout nav.
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
import { Download, FileText, Scale, ShieldAlert, Upload } from "lucide-react";

const DOC_TYPES = [
  ["contract", "Original retail contract (RC)"],
  ["notice_611", "§9-611 notice (default / intent to sell)"],
  ["notice_613", "§9-613 notice (contents/form)"],
  ["notice_616", "§9-616 deficiency explanation"],
  ["default_notice", "Default notice"],
  ["notice_of_sale", "Notice of sale (time/place/date)"],
  ["ucc1", "UCC-1 financing statement"],
  ["prospectus_424b5", "424B5 prospectus"],
  ["report_10k", "10-K report"],
  ["report_8k", "8-K report"],
  ["sales_servicing_agreement", "Sale & servicing agreement"],
  ["pacer_case", "PACER case file (Wright / Leal)"],
  ["dmv_title", "Title / DMV record"],
  ["repo_work_order", "Repo work order"],
  ["other", "Other"],
] as const;

export default function RepoPage() {
  const qc = useQueryClient();
  const [ack, setAck] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>("contract");
  const [caseId, setCaseId] = useState<number | undefined>(undefined);

  const cases = useQuery(trpc.repo.listCases.queryOptions());
  const violations = useQuery(trpc.repo.listViolations.queryOptions());

  const upload = useMutation(trpc.repo.uploadDocument.mutationOptions({
    onSuccess: (r) => { setAck(r.message); setFile(null); qc.invalidateQueries(); },
  }));
  const openCase = useMutation(trpc.repo.openCase.mutationOptions({
    onSuccess: (r) => { setCaseId(r.id); qc.invalidateQueries(); },
  }));
  const analyze = useMutation(trpc.repo.analyzeCase.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const sec = useQuery({
    ...trpc.repo.secDueDiligence.queryOptions({ caseId: caseId ?? 0 }, ),
    enabled: !!caseId,
  });

  const toBase64 = (f: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  return (
    <div className="repo-page">
      <PageTitle eyebrow="Self-Help Repossession Defense" title="Repossession"
        description="The agent reconstructs the securitization chain (424B5 → 10-K → 8-K → UCC-1 → sale & servicing agreement), audits every §9-611/613/616 notice, and drafts the demand and federal complaint on the Wright v. Santander structure." />

      {ack && <div className="ack-banner" role="status"><ShieldAlert /> {ack}</div>}

      <Card>
        <CardHeader><CardTitle><Scale /> Open a repossession case</CardTitle></CardHeader>
        <CardContent className="case-grid">
          <Input id="creditor" placeholder="Creditor / servicer (e.g., Toyota Motor Credit)" />
          <Input id="agency" placeholder="Repo agency (optional)" />
          <Input id="vehicle" placeholder="Vehicle (year make model)" />
          <Input id="vin" placeholder="VIN (optional)" />
          <Select defaultValue="FL" onValueChange={() => {}}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="FL">Florida</SelectItem><SelectItem value="CA">California</SelectItem></SelectContent>
          </Select>
          <Button onClick={() => {
            const g = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? "";
            openCase.mutate({ creditorName: g("creditor") || "Unknown creditor", repoAgencyName: g("agency") || undefined, vehicle: g("vehicle") || "Unknown vehicle", vin: g("vin") || undefined, state: "FL" });
          }} disabled={openCase.isPending}>Open case</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><Upload /> Upload case documents</CardTitle></CardHeader>
        <CardContent className="upload-grid">
          <Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Button disabled={!file || upload.isPending} onClick={async () => file && upload.mutate({
            name: file.name, contentBase64: await toBase64(file), contentType: file.type || undefined,
            docType: docType as any, caseId,
          })}>{upload.isPending ? "Filing…" : "Upload & file as exhibit"}</Button>
        </CardContent>
      </Card>

      {caseId && (
        <Card>
          <CardHeader><CardTitle>SEC due diligence</CardTitle></CardHeader>
          <CardContent>
            <p>Prospectus → 10-K → 8-K (contract year) → UCC-1 → sale & servicing agreement → RC timestamp. Missing items become demand items with retrieval cost.</p>
            {sec.data?.report && <pre className="report">{sec.data.report}</pre>}
            <Button onClick={() => analyze.mutate({ caseId })} disabled={analyze.isPending}>Run full investigation</Button>
          </CardContent>
        </Card>
      )}

      <section className="violation-map">
        <h2>Violation map</h2>
        {violations.data?.length === 0 && <EmptyState title="No violations yet" text="Upload documents and run the investigation." />}
        {violations.data?.map(v => (
          <div key={v.id} className={`violation ${v.severity}`}>
            <Badge className={v.severity}>{v.severity}</Badge> <strong>{v.title}</strong>
            <p className="statute">{v.statute}</p>
            <p>{v.annotation}</p>
            <p className="excerpt">Found: {v.excerpt}</p>
          </div>
        ))}
      </section>

      {caseId && (
        <section className="drafts">
          <h2>Drafts for attorney review</h2>
          <DraftButtons caseId={caseId} />
          <CaseFiles caseId={caseId} />
        </section>
      )}
    </div>
  );
}

function DraftButtons({ caseId }: { caseId: number }) {
  const qc = useQueryClient();
  const draft = useMutation({
    mutationFn: async (draftType: "notice_of_demand" | "federal_complaint" | "special_report" | "demand_checklist") => {
      const fn = draftType === "demand_checklist"
        ? trpc.repo.generateDocumentDemand.fetch({ caseId, sendTo: "both" })
        : trpc.repo.generateDraft.fetch({ caseId, draftType: draftType as any });
      const r: any = await fn;
      const blob = new Blob([r.letter ?? r.unavailable ?? ""], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${draftType}-${caseId}.txt`;
      a.click();
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="draft-buttons">
      <Button variant="outline" onClick={() => draft.mutate("demand_checklist")} disabled={draft.isPending}>Document demand to creditor + repo agency</Button>
      <Button variant="outline" onClick={() => draft.mutate("notice_of_demand")} disabled={draft.isPending}>Notice of demand</Button>
      <Button variant="outline" onClick={() => draft.mutate("federal_complaint")} disabled={draft.isPending}>Federal complaint (Wright structure)</Button>
      <Button variant="outline" onClick={() => draft.mutate("special_report")} disabled={draft.isPending}>Special report — securitization concealment</Button>
    </div>
  );
}

function CaseFiles({ caseId }: { caseId: number }) {
  const bundle = useQuery(trpc.repo.caseBundle.queryOptions({ caseId }));
  return (
    <div className="case-files">
      {bundle.data?.files.map((f: any, i: number) => (
        <p key={i}><FileText size={14} /> {f.exhibit} [{f.docType}] {f.name} — <a href={f.url}><Download size={14} /> download</a></p>
      ))}
    </div>
  );
}
