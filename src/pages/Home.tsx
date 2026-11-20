import { ArrowRight, BookOpen, FileStack, Scale, ShieldCheck, Smartphone, Upload } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { BRAND, SERVICE_AREAS } from "@contracts/portal";

const services = [
  { title: "Debt-collection case organization", text: "Keep the complaint, service papers, pleadings, court dates, and case notes together." },
  { title: "Credit-report review", text: "Organize reports, account histories, dispute records, and responses without promises of guaranteed deletion." },
  { title: "Billing-error records", text: "Collect periodic statements, receipts, correspondence, and supporting documents in one timeline." },
  { title: "Repossession document review", text: "Store loan documents, notices, sale records, payment histories, and deficiency statements." },
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
