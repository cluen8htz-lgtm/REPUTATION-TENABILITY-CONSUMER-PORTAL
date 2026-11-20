/**
 * End-to-end integration check against a real MySQL database.
 *   DATABASE_URL=… npm run test:integration
 * Uses an in-memory blob driver and AI_DISABLED, so it needs no external services.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
process.env.AI_DISABLED = "true";
const { appRouter } = await import("../api/router");
const { getDb } = await import("../api/queries/connection");
const { MemoryDriver, setBlobDriver } = await import("../api/lib/blob");
const schema = await import("../db/schema");
const { CUEVAS_AUGUST, samplePdf } = await import("./unit/fixtures");

const memory = new MemoryDriver();
setBlobDriver(memory);
const db = getDb();
const stamp = Date.now();
const created: number[] = [];

async function makeUser(role: "user" | "admin") {
  const unionId = `it:${role}:${stamp}:${created.length}`;
  await db.insert(schema.users).values({ unionId, name: `IT ${role}`, email: `${role}-${stamp}-${created.length}@example.test`, role });
  const user = (await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)))[0];
  created.push(user.id);
  return user;
}
const caller = (user: Awaited<ReturnType<typeof makeUser>>) =>
  appRouter.createCaller({ req: new Request("http://localhost/api/trpc"), resHeaders: new Headers(), user });

let passed = false;
try {
  const client = await makeUser("user");
  const other = await makeUser("user");
  const admin = await makeUser("admin");
  const c = caller(client);

  await c.portal.saveIntake({ state: "FL", county: "Broward", serviceInterest: "Credit-card billing error", contactPreference: "Email", intakeCompleted: true });
  const kase = await c.portal.createCase({ title: "IT case", plaintiff: "Plaintiff LLC", defendant: "IT user", state: "FL", county: "Broward", caseType: "Debt collection" });
  await assert.rejects(caller(other).portal.createCall({ caseId: kase.id, collectorName: "Collector", calledAt: "2026-01-01 10:00", direction: "incoming", summary: "call", consentAcknowledged: true }), /not found/i);
  const doc = await c.portal.uploadDocument({ name: "summons.pdf", contentBase64: Buffer.from(await samplePdf()).toString("base64"), contentType: "application/pdf", category: "court", caseId: kase.id });
  assert.ok(memory.files.has(doc.key));
  await assert.rejects(c.portal.adminOverview(), /permission/i);
  await caller(admin).portal.adminReviewDocument({ id: doc.id, staffSummary: "Reviewed in integration test." });

  // FCBA: upload → (AI disabled) analyze reports failure → manual facts → engine → letter
  const up = await c.fcba.uploadStatement({ name: "aug.pdf", contentBase64: Buffer.from(await samplePdf()).toString("base64"), contentType: "application/pdf", category: "statements", isFirstStatement: true });
  assert.equal(up.exhibitLabel, "Exhibit A");
  const analysis = await c.fcba.analyzeStatement({ id: up.id });
  assert.ok("error" in analysis && analysis.error);
  const run = await c.fcba.saveFacts({ id: up.id, facts: CUEVAS_AUGUST });
  assert.ok(run.hits.length >= 7);
  assert.equal(run.located["FCBA-001"], 1);
  const dispute = await c.fcba.createDispute({ creditorName: "Card Bank", accountLast4: "6109", noticeType: "billing_error", creditorReceivedDate: "2025-12-01" });
  const letter = await c.fcba.generateDisputeLetter({ disputeId: dispute.id, useAi: true });
  assert.equal(letter.source, "template");
  assert.match(letter.letter, /2025-12-31/);
  await assert.rejects(caller(other).fcba.statement({ id: up.id }), /not found/i);

  // Repossession
  const repo = await c.repo.openCase({ creditorName: "Lender", vehicle: "2022 Sedan", state: "FL" });
  const screen = await c.repo.saveFacts({ caseId: repo.id, facts: { ...(await import("../contracts/repo-engine")).EMPTY_REPO_FACTS, noticeOfSaleReceived: "no" } });
  assert.deepEqual(screen.hits.map((h) => h.ruleId), ["REPO-003"]);
  const draft = await c.repo.generateDraft({ caseId: repo.id, draftType: "document_demand", useAi: false });
  assert.match(draft.body, /Retail installment contract|retail installment contract/i);

  passed = true;
  console.log(JSON.stringify({ status: "passed", checks: ["intake", "case + cross-account rejection", "private upload", "admin boundary", "FCBA engine + annotation + template letter", "repo screening + draft"] }, null, 2));
} catch (error) {
  console.error("Integration test failed:", error);
} finally {
  if (created.length) {
    for (const table of [schema.fcbaViolations, schema.fcbaStatements, schema.fcbaDisputes, schema.fcbaEvents, schema.repoViolations, schema.repoDrafts, schema.repoEvents, schema.repoDocuments, schema.repoCases, schema.documents, schema.callLogs, schema.courtCases, schema.clientProfiles]) {
      await db.delete(table).where(inArray(table.userId, created)).catch(() => undefined);
    }
    await db.delete(schema.users).where(inArray(schema.users.id, created)).catch(() => undefined);
  }
  process.exit(passed ? 0 : 1);
}
