import { ArrowRight, BookOpen, Car, CreditCard, FileStack, Lock, Scale, ShieldCheck, Smartphone, Sparkles, Upload } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { BRAND, SERVICE_AREAS } from "@contracts/portal";

const services = [
  { title: "Debt-collection case organization", text: "Keep the complaint, service papers, pleadings, court dates, and case notes together." },
  { title: "Credit-report review", text: "Organize reports, account histories, dispute records, and responses without promises of guaranteed deletion." },
  { title: "Credit-card billing-error analysis", text: "Each statement becomes a labeled exhibit, is screened against 13 Fair Credit Billing Act rules, and comes back marked — red triangles at summary fields, brackets under line items." },
  { title: "Repossession review", text: "Contract, Article 9 notices, title, UCC-1, and the trust's SEC filings, screened for notice, redemption, breach-of-peace, and deficiency issues in Florida and California." },
  { title: "Financial education", text: "Build practical knowledge about credit utilization, account records, and consumer finance." },
  { title: "Information and referrals", text: "Know when a court issue calls for a licensed attorney or qualified legal-aid organization." },
];

export default function Home() {
  const [shared, setShared] = useState(false);

  async function sharePage() {
    const data = { title: BRAND.name, text: "Consumer credit and case-record education", url: window.location.href };
    if (navigator.share) {
      await navigator.share(data).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    setShared(true);
    window.setTimeout(() => setShared(false), 2200);
  }

  return (
    <div className="public-shell">
      <header className="public-header">
        <Link to="/" className="brand-lockup" aria-label="Reputation Tenability home">
          <img src="/reputation-tenability-logo.png" alt="" />
          <span><strong>REPUTATION TENABILITY</strong><small>FINANCIAL INTERVENTION · RESTORATION</small></span>
        </Link>
        <nav className="public-nav" aria-label="Main navigation">
          <a href="#services">Services</a>
          <a href="#engines">How it works</a>
          <a href="#areas">Service areas</a>
          <a href="#education">Education</a>
        </nav>
        <Link to="/login" className="text-link">Client sign in <ArrowRight aria-hidden="true" /></Link>
      </header>

      <main>
        <section className="portal-hero">
          <div className="hero-copy">
            <p className="overline">YOUR RECORDS · YOUR CASE · YOUR NEXT STEP</p>
            <h1>Turn financial paperwork into a <em>clear path forward.</em></h1>
            <p className="hero-intro">A secure client workspace for debt-collection lawsuits, credit-report concerns, billing errors, and repossession records.</p>
            <div className="hero-proof"><ShieldCheck aria-hidden="true" /><span>Private document storage<br />Staff-reviewed case organization</span></div>
          </div>
          <div className="hero-portal">
            <div className="logo-orbit"><img src="/reputation-tenability-logo.png" alt="Reputation Tenability" /></div>
            <div className="portal-actions">
              <Link to="/portal/intake" className="portal-action primary"><span>Start secure intake</span><ArrowRight /></Link>
              <Link to="/portal" className="portal-action"><span>Open client workspace</span><ArrowRight /></Link>
              <a href="#education" className="portal-action"><span>Learn before you upload</span><ArrowRight /></a>
            </div>
          </div>
        </section>

        <section id="services" className="editorial-section">
          <div className="section-label"><span>WHAT WE ORGANIZE</span><FileStack aria-hidden="true" /></div>
          <div className="service-list">
            {services.map((service, index) => (
              <article key={service.title} className="service-row">
                <span className="service-index">{String(index + 1).padStart(2, "0")}</span>
                <h2>{service.title}</h2>
                <p>{service.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="engines" className="engine-section">
          <div className="section-label"><span>TWO ANALYSIS ENGINES</span><Sparkles aria-hidden="true" /></div>
          <div className="engine-grid">
            <article className="engine-card">
              <div className="engine-head"><CreditCard aria-hidden="true" /><div><p className="overline">FAIR CREDIT BILLING ACT</p><h2>Billing-error workspace</h2></div></div>
              <StatementMock />
              <ol className="engine-steps">
                <li><strong>File</strong> each statement — instant receipt, Exhibit A, B, C…</li>
                <li><strong>Read</strong> the figures (AI-assisted, always reviewable by you)</li>
                <li><strong>Screen</strong> against FCBA-001 … FCBA-013 in auditable code</li>
                <li><strong>Draft</strong> the §1666 notice and track the 30- and 90-day clocks</li>
              </ol>
            </article>
            <article className="engine-card">
              <div className="engine-head"><Car aria-hidden="true" /><div><p className="overline">SELF-HELP REPOSSESSION · FL & CA</p><h2>Repossession workspace</h2></div></div>
              <ul className="repo-mock" aria-label="Example screening indicators">
                <li className="critical"><span>REPO-003</span>Sale notice missing time, place, or date</li>
                <li className="major"><span>REPO-002</span>Notice sender differs from secured party of record</li>
                <li className="major"><span>REPO-007</span>Deficiency demanded without explanation</li>
                <li className="ok"><span>9-623</span>Redemption window: 6 days remaining</li>
              </ul>
              <ol className="engine-steps">
                <li><strong>Gather</strong> contract, notices, title, UCC-1, and SEC filings</li>
                <li><strong>Answer</strong> a plain-language questionnaire (pre-fill from documents)</li>
                <li><strong>Screen</strong> REPO-001 … REPO-008 with state-specific rules</li>
                <li><strong>Draft</strong> the document demand, notice of demand, and special report</li>
              </ol>
            </article>
          </div>
          <div className="trust-row">
            <span><Lock aria-hidden="true" />Files never get public links — every download re-checks your account</span>
            <span><ShieldCheck aria-hidden="true" />Rules decide findings, not a chatbot — every mark cites its statute</span>
            <span><Scale aria-hidden="true" />Every draft is prepared for attorney review, never sent automatically</span>
          </div>
        </section>

        <section id="areas" className="area-section">
          <div>
            <p className="overline">INITIAL COVERAGE</p>
            <h2>Local focus.<br /><em>One organized record.</em></h2>
          </div>
          <div className="area-grid">
            {SERVICE_AREAS.map((area) => (
              <div key={area.state} className="area-column">
                <strong>{area.state === "FL" ? "South Florida" : "Southern California"}</strong>
                <span>{area.state}</span>
                <ul>{area.counties.map((county) => <li key={county}>{county} County</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions clients ask first</h2>
          {[
            ["Is this legal advice?", "No. Reputation Tenability is a credit-repair and financial-consulting business, not a law firm. The workspace organizes your records and prepares drafts for review by a licensed attorney or legal-aid organization."],
            ["Who can see my documents?", "Only you and assigned staff. Files are stored privately and are streamed through your signed-in session; there are no shareable links."],
            ["Does the AI decide whether there is a violation?", "No. AI may help read figures from a statement, which you can review and correct. Whether a rule applies is decided by published, testable rules that cite the statute for each finding."],
            ["What do I need to start?", "Your most recent statement or notice is enough. For billing errors, the first statement after the account opened matters most; for repossession, every notice you received after the vehicle was taken."],
          ].map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>

        <section id="education" className="education-section">
          <div className="education-title"><BookOpen aria-hidden="true" /><h2>Start with the document in front of you.</h2></div>
          <div className="education-grid">
            <article><Scale /><h3>Received a lawsuit?</h3><p>Preserve the summons, complaint, every envelope, and any service information. Court-response deadlines require qualified review.</p></article>
            <article><Upload /><h3>Gather the account story.</h3><p>Periodic statements, payment records, collection letters, and credit reports can help explain what changed and when.</p></article>
            <article><Smartphone /><h3>Document collection calls.</h3><p>Record the date, caller, company, and what was said. Only make or share recordings when legally permitted.</p></article>
          </div>
          <button type="button" className="share-button" onClick={sharePage}>{shared ? "Link copied" : "Share this educational page"}<ArrowRight /></button>
        </section>
      </main>

      <footer className="public-footer">
        <div><strong>{BRAND.name}</strong><p>Credit repair · Financial consultancy · Consumer education</p></div>
        <div><a href={`mailto:${BRAND.email}`}>{BRAND.email}</a><a href={`tel:${BRAND.phone}`}>{BRAND.phone}</a><span>{BRAND.website}</span></div>
        <p className="legal-note">Reputation Tenability is a credit-repair and financial-consulting business, not a law firm. Information is general education, not legal advice. No credit-report deletion, score improvement, debt elimination, or lawsuit outcome is guaranteed. Contact details supplied in company materials should be confirmed before public launch.</p>
      </footer>
    </div>
  );
}

function StatementMock() {
  return (
    <svg className="statement-mock" viewBox="0 0 360 210" role="img" aria-label="Example statement with a red triangle around the credit limit and brackets under line items">
      <rect x="1" y="1" width="358" height="208" rx="3" className="paper" />
      <text x="18" y="28" className="mock-title">ACCOUNT SUMMARY</text>
      {[["Previous Balance", "$0.00", 54], ["Payments, Credits", "-$200.00", 78], ["Purchases", "+$910.80", 102], ["Credits", "$0.00", 126], ["New Balance", "$779.80", 150]].map(([label, value, y]) => (
        <g key={label as string}><text x="18" y={y as number} className="mock-row">{label}</text><text x="170" y={y as number} className="mock-row" textAnchor="end">{value}</text></g>
      ))}
      <path d="M16 82 H174 M16 82 v-5 M174 82 v-5" className="mark-bracket" />
      <path d="M16 130 H174 M16 130 v-5 M174 130 v-5" className="mark-bracket" />
      <path d="M16 154 H174 M16 154 v-5 M174 154 v-5" className="mark-bracket" />
      <text x="290" y="120" className="mock-row" textAnchor="middle">Credit Limit</text>
      <text x="290" y="138" className="mock-strong" textAnchor="middle">$8,000</text>
      <path d="M236 150 L344 150 L290 74 Z" className="mark-triangle" />
      <circle cx="342" cy="22" r="9" className="mark-dot" /><text x="342" y="26" className="mock-dot" textAnchor="middle">1</text>
      <text x="18" y="190" className="mock-note">FCBA-001 · 15 U.S.C. §1637(b)(2) · 12 C.F.R. §1026.8(b)</text>
    </svg>
  );
}
