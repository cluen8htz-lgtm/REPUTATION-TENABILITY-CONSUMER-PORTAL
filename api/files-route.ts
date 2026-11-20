/**
 * files-route.ts — authenticated downloads, ZIP bundles, and calendar feeds.
 *
 * Every request re-authenticates from the session cookie and re-checks that
 * the record belongs to the caller (or that the caller is staff). Files are
 * streamed through the app — no public or long-lived URLs ever exist.
 */
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { and, asc, eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { documents, fcbaDisputes, fcbaStatements, fcbaViolations, repoCases, repoDocuments, repoDrafts, repoViolations } from "@db/schema";
import type { User } from "@db/schema";
import { blob } from "./lib/blob";
import { textToPdf } from "./fcba/annotate";
import { deadlineStatus } from "@contracts/fcba-engine";
import { log } from "./lib/logger";

type App = Hono<{ Bindings: HttpBindings }>;

async function currentUser(c: Context): Promise<User | null> {
  try {
    return (await authenticateRequest(c.req.raw.headers)) ?? null;
  } catch {
    return null;
  }
}

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 150) || "file";
}

function send(c: Context, bytes: Uint8Array, contentType: string, fileName: string, inline: boolean) {
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeName(fileName).replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return c.body(bytes as unknown as ArrayBuffer, 200, {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox",
  });
}

const INLINE_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)$/;

function icsEscape(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
}

export function buildIcs(events: Array<{ uid: string; date: string; summary: string; description: string }>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reputation Tenability//Client Portal//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Reputation Tenability deadlines"];
  for (const e of events) {
    const day = e.date.slice(0, 10).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@reputation-tenability`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${icsEscape(e.summary)}`, `DESCRIPTION:${icsEscape(e.description)}`, "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.summary)}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function registerFileRoutes(app: App) {
  app.get("/api/files/:kind/:id", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Bad id" }, 400);
    const inline = c.req.query("download") !== "1";
    const db = getDb();
    const staff = user.role === "admin";
    try {
      switch (c.req.param("kind")) {
        case "document": {
          const doc = await db.query.documents.findFirst({ where: staff ? eq(documents.id, id) : and(eq(documents.id, id), eq(documents.userId, user.id)) });
          if (!doc) break;
          const ct = doc.contentType ?? "application/octet-stream";
          return send(c, await blob().get(doc.fileKey), ct, doc.fileName, inline && INLINE_TYPES.test(ct));
        }
        case "fcba":
        case "fcba-annotated": {
          const stmt = await db.query.fcbaStatements.findFirst({ where: staff ? eq(fcbaStatements.id, id) : and(eq(fcbaStatements.id, id), eq(fcbaStatements.userId, user.id)) });
          if (!stmt) break;
          if (c.req.param("kind") === "fcba-annotated") {
            if (!stmt.annotatedFileKey) break;
            return send(c, await blob().get(stmt.annotatedFileKey), "application/pdf", `${stmt.exhibitLabel} - ANNOTATED - ${stmt.fileName.replace(/\.[^.]+$/, "")}.pdf`, inline);
          }
          const ct = stmt.contentType ?? "application/octet-stream";
          return send(c, await blob().get(stmt.fileKey), ct, `${stmt.exhibitLabel} - ${stmt.fileName}`, inline && INLINE_TYPES.test(ct));
        }
        case "fcba-letter": {
          const dispute = await db.query.fcbaDisputes.findFirst({ where: and(eq(fcbaDisputes.id, id), eq(fcbaDisputes.userId, user.id)) });
          if (!dispute?.letterDraft) break;
          return send(c, await textToPdf(`${dispute.creditorName} — account ending ${dispute.accountLast4}`, dispute.letterDraft), "application/pdf", `Dispute-letter-${dispute.accountLast4}.pdf`, inline);
        }
        case "repo": {
          const doc = await db.query.repoDocuments.findFirst({ where: staff ? eq(repoDocuments.id, id) : and(eq(repoDocuments.id, id), eq(repoDocuments.userId, user.id)) });
          if (!doc) break;
          const ct = doc.contentType ?? "application/octet-stream";
          return send(c, await blob().get(doc.fileKey), ct, `${doc.exhibitLabel} - ${doc.fileName}`, inline && INLINE_TYPES.test(ct));
        }
        case "repo-draft": {
          const draft = await db.query.repoDrafts.findFirst({ where: and(eq(repoDrafts.id, id), eq(repoDrafts.userId, user.id)) });
          if (!draft) break;
          return send(c, await textToPdf(draft.draftType.replaceAll("_", " ").toUpperCase(), draft.body), "application/pdf", `${draft.draftType}-${draft.id}.pdf`, inline);
        }
      }
    } catch (error) {
      log.error("file download failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "File unavailable" }, 502);
    }
    return c.json({ error: "Not Found" }, 404);
  });

  /** FCBA exhibit bundle: originals + annotated maps + letters + manifest, in exhibit order. */
  app.get("/api/bundles/fcba.zip", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);
    const db = getDb();
    const stmts = await db.select().from(fcbaStatements).where(eq(fcbaStatements.userId, user.id)).orderBy(asc(fcbaStatements.createdAt));
    const violations = await db.select().from(fcbaViolations).where(eq(fcbaViolations.userId, user.id));
    const disputes = await db.select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, user.id));
    const files: Record<string, Uint8Array> = {};
    const manifest: string[] = [`FCBA EXHIBIT BUNDLE — ${user.name ?? "Client"}`, `Prepared ${new Date().toISOString()}`, ""];
    for (const [i, s] of stmts.entries()) {
      const n = String(i + 1).padStart(2, "0");
      const folder = `${n} ${s.exhibitLabel}`;
      files[`${folder}/${safeName(s.fileName)}`] = await blob().get(s.fileKey);
      if (s.annotatedFileKey) files[`${folder}/${s.exhibitLabel} - ANNOTATED.pdf`] = await blob().get(s.annotatedFileKey);
      const own = violations.filter((v) => v.statementId === s.id);
      manifest.push(`${n}. ${s.exhibitLabel} — ${s.folder}`, `    ${s.fileName}${s.cycle ? ` (cycle ${s.cycle})` : ""}`, `    Screening score: ${s.complianceScore ?? "not analyzed"}; findings: ${own.map((v) => v.ruleId).join(", ") || "none"}`, "");
    }
    manifest.push("DISPUTES");
    for (const d of disputes) {
      manifest.push(`- ${d.noticeType.replaceAll("_", " ")} — ${d.creditorName} (****${d.accountLast4}) — ${d.status}${d.ackDeadline ? `; acknowledge by ${d.ackDeadline}` : ""}${d.resolveDeadline ? `; resolve by ${d.resolveDeadline}` : ""}`);
      if (d.letterDraft) files[`Letters/${d.noticeType}-${d.accountLast4}-${d.id}.pdf`] = await textToPdf(`${d.creditorName} — account ending ${d.accountLast4}`, d.letterDraft);
    }
    files["MANIFEST.txt"] = strToU8(manifest.join("\n"));
    const zip = zipSync(files, { level: 6 });
    return c.body(zip as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="FCBA-Exhibit-Bundle-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "private, no-store",
    });
  });

  app.get("/api/bundles/repo/:caseId", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);
    const caseId = Number(c.req.param("caseId"));
    const db = getDb();
    const kase = await db.query.repoCases.findFirst({ where: and(eq(repoCases.id, caseId), eq(repoCases.userId, user.id)) });
    if (!kase) return c.json({ error: "Not Found" }, 404);
    const docs = await db.select().from(repoDocuments).where(and(eq(repoDocuments.caseId, caseId), eq(repoDocuments.userId, user.id))).orderBy(asc(repoDocuments.createdAt));
    const drafts = await db.select().from(repoDrafts).where(and(eq(repoDrafts.caseId, caseId), eq(repoDrafts.userId, user.id)));
    const violations = await db.select().from(repoViolations).where(and(eq(repoViolations.caseId, caseId), eq(repoViolations.userId, user.id)));
    const files: Record<string, Uint8Array> = {};
    for (const [i, d] of docs.entries()) files[`Exhibits/${String(i + 1).padStart(2, "0")} ${d.exhibitLabel} - ${safeName(d.fileName)}`] = await blob().get(d.fileKey);
    for (const d of drafts) files[`Drafts/${d.draftType}-${d.id}.pdf`] = await textToPdf(d.draftType.replaceAll("_", " ").toUpperCase(), d.body);
    files["MANIFEST.txt"] = strToU8([
      `REPOSSESSION CASE BUNDLE — ${kase.creditorName} / ${kase.vehicle}`,
      `State ${kase.state} · repossessed ${kase.repossessionDate ?? "?"} · sale ${kase.saleDate ?? "?"} · risk ${kase.riskScore ?? "n/a"}/100`,
      "",
      "SCREENING INDICATORS",
      ...violations.map((v) => `- [${v.ruleId}] ${v.title} (${v.severity}) — ${v.statute}\n    ${v.excerpt}`),
      "",
      "EXHIBITS",
      ...docs.map((d) => `- ${d.exhibitLabel}: ${d.fileName} (${d.docType})`),
    ].join("\n"));
    return c.body(zipSync(files, { level: 6 }) as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Repossession-Case-${caseId}.zip"`,
      "Cache-Control": "private, no-store",
    });
  });

  /** All open deadlines as an iCalendar file (3-day reminders). */
  app.get("/api/calendar/deadlines.ics", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);
    const db = getDb();
    const todayIso = new Date().toISOString().slice(0, 10);
    const disputes = await db.select().from(fcbaDisputes).where(eq(fcbaDisputes.userId, user.id));
    const events = disputes.flatMap((d) => [
      d.ackDeadline && deadlineStatus(d.ackDeadline, todayIso) !== "overdue" ? { uid: `fcba-ack-${d.id}`, date: d.ackDeadline, summary: `${d.creditorName}: FCBA acknowledgment due`, description: `30-day acknowledgment deadline, 15 U.S.C. §1666(a)(1). Account ending ${d.accountLast4}.` } : null,
      d.resolveDeadline && deadlineStatus(d.resolveDeadline, todayIso) !== "overdue" ? { uid: `fcba-res-${d.id}`, date: d.resolveDeadline, summary: `${d.creditorName}: FCBA resolution due`, description: `Resolution deadline (two billing cycles, max 90 days), 15 U.S.C. §1666(a)(3). Account ending ${d.accountLast4}.` } : null,
    ]).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const repo = await db.select().from(repoCases).where(eq(repoCases.userId, user.id));
    for (const k of repo) if (k.saleDate && k.saleDate.slice(0, 10) >= todayIso) events.push({ uid: `repo-sale-${k.id}`, date: k.saleDate, summary: `${k.vehicle}: scheduled disposition`, description: "Right to redeem generally ends at disposition (UCC 9-623). Confirm with counsel." });
    return c.body(buildIcs(events), 200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="reputation-tenability-deadlines.ics"' });
  });
}
