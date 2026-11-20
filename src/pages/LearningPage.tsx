import { useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, Bot, Clock3, ExternalLink, FileSearch, Play, Send, Sparkles } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { EmptyState, LoadingPanel, PageTitle } from "@/components/PortalComponents";

const guides = [
  {
    title: "When court papers arrive",
    tag: "DEBT-COLLECTION LAWSUITS",
    summary: "Preserve the complete packet before trying to interpret it.",
    steps: ["Keep the summons, complaint, exhibits, envelopes, and any proof-of-service document together.", "Scan every page, including blank-looking reverse sides and certificate pages.", "Record the date and manner in which you received the papers without guessing at a response deadline.", "Seek prompt review from a licensed attorney or qualified legal-aid organization, especially before any court date."],
  },
  {
    title: "Build a credit-report dispute file",
    tag: "CREDIT REPORTS",
    summary: "Identify the specific entry and the specific reason you believe it is inaccurate.",
    steps: ["Save the complete report and note the bureau, report date, account name, and identifying account fragment.", "Compare the entry with statements, payment records, identity documents, and prior correspondence.", "Write a focused factual dispute and keep a copy of everything sent, including delivery records.", "Track the response and any updated report. Accurate, current negative information is not guaranteed to be deleted."],
  },
  {
    title: "Organize a billing-error timeline",
    tag: "CREDIT-CARD BILLING ERRORS",
    summary: "Start with the statement and the transaction or charge at issue.",
    steps: ["Preserve periodic statements before and after the charge, receipts, merchant communications, and account notices.", "Write down when you first noticed the issue and every contact you made.", "Do not ignore account or court notices while a dispute is being reviewed.", "Ask a qualified professional how timing and procedural requirements apply to your facts."],
  },
  {
    title: "After a repossession notice",
    tag: "REPOSSESSION",
    summary: "Keep the loan history, notices, and sale paperwork in chronological order.",
    steps: ["Save the retail installment contract or note, payment history, default notices, and communications with the lender.", "Keep any notice of sale, redemption information, sale results, and deficiency statement.", "Do not assume that repossession ends every possible obligation or that every claimed balance is correct.", "Have a licensed attorney review notices and deadlines for your jurisdiction and documents."],
  },
];

const prompts = [
  "What documents should I gather after receiving a collection lawsuit?",
  "How can I organize a factual credit-report dispute?",
  "What records are useful after a vehicle repossession?",
];

export default function LearningPage() {
  const videosQuery = trpc.portal.listVideos.useQuery();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [unavailable, setUnavailable] = useState("");

  const assistant = trpc.portal.askAssistant.useMutation({
    onSuccess: (result) => {
      setAnswer(result.answer);
      setUnavailable(result.unavailable);
    },
    onError: () => {
      setAnswer("");
      setUnavailable("The education assistant could not complete this request. Your saved records are unaffected; please try again deliberately later.");
    },
  });

  function ask(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 5) return;
    setAnswer("");
    setUnavailable("");
    assistant.mutate({ question: question.trim() });
  }

  return <>
    <PageTitle eyebrow="LEARNING CENTER" title="Understand the record before choosing the next step." description="Practical educational guides, staff-published video lessons, and a general-information assistant for your organizing questions." />

    <section className="assistant-panel">
      <div className="assistant-heading"><div><Bot /><span>GENERAL EDUCATION ASSISTANT</span></div><Sparkles /></div>
      <h2>Ask about organizing your next step.</h2>
      <p>The assistant provides general education, not legal advice. It does not verify your documents, calculate court deadlines, or promise credit or debt outcomes.</p>
      <form onSubmit={ask} className="assistant-form"><label className="visually-hidden" htmlFor="assistant-question">Ask an educational question</label><textarea id="assistant-question" rows={3} maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Example: What records should I compare when an account balance looks wrong?" /><button className="gold-button" disabled={assistant.isPending || question.trim().length < 5}><Send />{assistant.isPending ? "Thinking…" : "Ask assistant"}</button></form>
      <div className="prompt-chips">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div>
      {(answer || unavailable || assistant.isPending) && <div className={`assistant-response ${unavailable ? "unavailable" : ""}`} aria-live="polite">{assistant.isPending ? <><span className="thinking-dot" /><p>Preparing a cautious educational response…</p></> : unavailable ? <p>{unavailable}</p> : <><strong>EDUCATIONAL RESPONSE</strong><p>{answer}</p><small>Verify legal rights, procedures, and deadlines with a licensed attorney or qualified legal aid.</small></>}</div>}
    </section>

    <section className="learning-section">
      <div className="section-heading"><div><p className="overline">START HERE</p><h2>Document-first guides</h2></div><BookOpen /></div>
      <div className="guide-list">{guides.map((guide, index) => <details key={guide.title} className="guide-item" open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span><div><small>{guide.tag}</small><h3>{guide.title}</h3><p>{guide.summary}</p></div><ArrowUpRight /></summary><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol></details>)}</div>
    </section>

    <section className="learning-section video-library">
      <div className="section-heading"><div><p className="overline">STAFF-PUBLISHED</p><h2>Video classes</h2></div><Play /></div>
      {videosQuery.isLoading ? <LoadingPanel /> : (videosQuery.data ?? []).length === 0 ? <EmptyState title="Video library being prepared" text="Staff can publish reviewed class links here. The document-first guides above are available now." /> : <div className="video-grid">{(videosQuery.data ?? []).map((video) => <article className="video-card" key={video.id}><div className="video-card-top"><span>{video.category}</span><Play /></div><h3>{video.title}</h3><p>{video.description}</p><div className="video-card-bottom"><span><Clock3 />{video.duration || "Self-paced"}</span><a href={video.videoUrl} target="_blank" rel="noopener noreferrer">Watch class<ExternalLink /></a></div></article>)}</div>}
    </section>

    <section className="research-note"><FileSearch /><div><h2>Have research or court materials?</h2><p>Upload PACER reports, pleadings, orders, or case-law materials to your file cabinet for safekeeping. This release does not automatically extract dockets, conduct legal research, or treat uploaded allegations as established facts.</p></div></section>
  </>;
}
