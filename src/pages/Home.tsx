import { ArrowRight, BookOpen, FileSearch, FileStack, Landmark, Scale, MessageCircle, ShieldCheck, Smartphone, Upload } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { BRAND, SERVICE_AREAS } from "@contracts/portal";
import HeroBackdrop from "@/components/HeroBackdrop";

const services = [
  { title: "Debt-collection case organization", text: "Keep the complaint, service papers, pleadings, court dates, and case notes together." },
  { title: "Credit-report review", text: "Organize reports, account histories, dispute records, and responses without promises of guaranteed deletion." },
  { title: "Credit-card billing-error analysis", text: "Each statement becomes a labeled exhibit, is screened against 13 Fair Credit Billing Act rules, and comes back marked — red triangles at summary fields, brackets under line items." },
  { title: "Repossession review", text: "Contract, Article 9 notices, title, UCC-1, and the trust's SEC filings, screened for notice, redemption, breach-of-peace, and deficiency issues in Florida and California." },
  { title: "Financial education", text: "Build practical knowledge about credit utilization, account records, and consumer finance." },
  { title: "Information and referrals", text: "Know when a court issue calls for a licensed attorney or qualified legal-aid organization." },
];

const FOUNDATION = [
  {
    icon: Landmark,
    title: "Informed Use of Credit",
    cite: "15 U.S.C. § 1601",
    text: "Promotes meaningful disclosure of credit terms so consumers can compare available credit, make informed decisions, and avoid the uninformed use of credit. It also addresses inaccurate and unfair credit-billing and credit-card practices.",
    message: "Understand the terms. Compare the costs. Make informed credit decisions.",
  },
  {
    icon: FileSearch,
    title: "Accuracy and Fairness in Credit Reporting",
    cite: "15 U.S.C. § 1681",
    text: "Recognizes that the banking system depends upon fair and accurate credit reporting. It calls for reasonable procedures concerning the confidentiality, accuracy, relevancy, and proper use of consumer information, with fairness, impartiality, and respect for consumer privacy.",
    message: "Review the record. Address inaccuracies. Expect fair treatment.",
  },
  {
    icon: ShieldCheck,
    title: "Protection From Abusive Debt Collection",
    cite: "15 U.S.C. § 1692",
    text: "Declares the purpose of eliminating abusive debt-collection practices and protecting consumers from conduct identified in the statute as abusive, deceptive, or unfair.",
    message: "Document the conduct. Understand your rights. Prepare your response.",
  },
] as const;

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
          <img src="/reputation-tenability-logo-600.webp" alt="" />
          <span><strong>REPUTATION TENABILITY</strong><small>FINANCIAL INTERVENTION AND RESTORATION</small></span>
        </Link>
        <nav className="public-nav" aria-label="Main navigation">
          <a href="#services">Services</a>
          <a href="#foundation">Your rights</a>
          <a href="#areas">Service areas</a>
          <a href="#education">Education</a>
        </nav>
        <div className="header-actions">
          <Link to="/login" className="text-link">Client sign in <ArrowRight aria-hidden="true" /></Link>
          <Link to="/signup" className="signup-pill">Sign up</Link>
        </div>
      </header>

      <main>
        <section className="portal-hero">
          <HeroBackdrop />
          <div className="hero-copy">
            <p className="overline">FINANCIAL INTERVENTION AND RESTORATION</p>
            <h1>Informed Choices.<br />Accurate Reports.<br /><em>Fair Treatment.</em></h1>
            <p className="hero-tagline">Know your rights. Protect your credit. Restore your name.</p>
            <p className="hero-intro">A consumer-advocacy portal grounded in the purposes of <strong>15 U.S.C. §§ 1601, 1681, and 1692</strong>—meaningful disclosure of credit terms, fair and accurate credit reporting, and protection from abusive debt-collection practices.</p>
            <div className="hero-proof"><ShieldCheck aria-hidden="true" /><span>Private document storage<br />Staff-reviewed case organization</span></div>
            <p className="hero-note">Organize your records, understand your rights, and prepare your next step through one secure client workspace.</p>
          </div>
          <div className="hero-portal">
            <div className="logo-orbit"><img src="/reputation-tenability-logo-600.webp" alt="Reputation Tenability" /></div>
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

        <section id="foundation" className="foundation-section" aria-labelledby="foundation-title">
          <div className="foundation-head">
            <p className="overline">CONSUMER ADVOCACY</p>
            <h2 id="foundation-title">The Legal Foundation for Consumer Advocacy</h2>
            <p>Three statutory purposes guide the portal: helping consumers understand credit, addressing inaccurate or unfair reporting, and organizing information concerning abusive debt-collection practices.</p>
          </div>
          <div className="foundation-grid">
            {FOUNDATION.map(({ icon: Icon, title, cite, text, message }) => (
              <article key={cite} className="foundation-card">
                <Icon aria-hidden="true" />
                <p className="foundation-cite">{cite}</p>
                <h3>{title}</h3>
                <p>{text}</p>
                <div className="core-message"><span>Core message</span><blockquote>{message}</blockquote></div>
              </article>
            ))}
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

        <section className="closing-statement" aria-labelledby="closing-title">
          <h2 id="closing-title"><em>Your reputation deserves a clear path forward.</em></h2>
          <p>Reputation Tenability brings documents, credit-report concerns, and debt-collection records into an organized workspace—helping consumers move from uncertainty to informed action.</p>
          <p className="closing-motto">Informed choices. Accurate reports. Fair treatment.</p>
          <p className="statute-disclaimer">These statutory summaries describe congressional findings and purposes. They are provided for general information and do not promise a particular legal outcome.</p>
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

      <a className="float-contact" href={`mailto:${BRAND.email}`} aria-label="Contact Reputation Tenability"><MessageCircle aria-hidden="true" /></a>

      <footer className="public-footer">
        <div><strong>{BRAND.name}</strong><p>Credit repair · Financial consultancy · Consumer education</p></div>
        <div><a href={`mailto:${BRAND.email}`}>{BRAND.email}</a><a href={`tel:${BRAND.phone}`}>{BRAND.phone}</a><span>{BRAND.website}</span></div>
        <p className="legal-note">Reputation Tenability is a credit-repair and financial-consulting business, not a law firm. Information is general education, not legal advice. No credit-report deletion, score improvement, debt elimination, or lawsuit outcome is guaranteed. Contact details supplied in company materials should be confirmed before public launch.</p>
      </footer>
    </div>
  );
}

