import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { callLogs, clientProfiles, courtCases, documents, users, videoLessons, type User } from "../db/schema";
import { storage } from "../api/lib/storage";
import { listModels } from "../api/ai/ai-client";

const stamp = Date.now();
const clientUnionId = `mvp-check-client-${stamp}`;
const adminUnionId = `mvp-check-admin-${stamp}`;
const videoTitle = `MVP verification class ${stamp}`;
const db = getDb();
let clientUser: User | undefined;
let adminUser: User | undefined;
let fileKey = "";
let aiStatus = "not run";
let attributionSeen = false;
let passed = false;

function context(user: User) {
  return { req: new Request("http://localhost/api/trpc"), resHeaders: new Headers(), user };
}

async function expectError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.equal((error as { code?: string }).code, code);
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (requestUrl.includes("/chat/completions") && headers.get("X-Kimi-App-Id") === process.env.APP_ID) {
    attributionSeen = true;
  }
  return originalFetch(input, init);
};

try {
  const [{ id: clientId }] = await db.insert(users).values({ unionId: clientUnionId, name: "MVP Test Client", email: "client@example.test", role: "user" }).$returningId();
  const [{ id: adminId }] = await db.insert(users).values({ unionId: adminUnionId, name: "MVP Test Admin", email: "admin@example.test", role: "admin" }).$returningId();
  clientUser = await db.query.users.findFirst({ where: eq(users.id, clientId) });
  adminUser = await db.query.users.findFirst({ where: eq(users.id, adminId) });
  assert(clientUser && adminUser);
  const client = appRouter.createCaller(context(clientUser));
  const staff = appRouter.createCaller(context(adminUser));

  await client.portal.saveIntake({ phone: "555-0100", state: "FL", county: "Miami-Dade", serviceInterest: "Credit-report review", contactPreference: "Secure message", intakeNotes: "Integration check only", intakeCompleted: true });
  const dashboard = await client.portal.dashboard();
  assert.equal(dashboard.profile?.intakeCompleted, true);

  const { id: caseId } = await client.portal.createCase({ title: "Integration test case", plaintiff: "Example Plaintiff", defendant: "Example Defendant", court: "Test Court", state: "FL", county: "Miami-Dade", caseNumber: "TEST-001", caseType: "Debt collection", filedOn: "2026-01-02", servedOn: "2026-01-03", nextDeadline: "2026-02-01", deadlineLabel: "Unverified test date", notes: "Temporary record" });
  await client.portal.updateCaseStatus({ id: caseId, status: "active" });
  assert.equal((await client.portal.listCases())[0].status, "active");
  await expectError(staff.portal.createCall({ caseId, collectorName: "Cross Account", calledAt: "2026-01-04T10:00", direction: "incoming", summary: "Must reject another user's case", consentAcknowledged: true }), "BAD_REQUEST");

  await client.portal.createCall({ caseId, collectorName: "Example Collector", phoneNumber: "555-0101", calledAt: "2026-01-04T10:00", direction: "incoming", summary: "Temporary integration call record", notes: "Cleanup required", consentAcknowledged: true });
  assert.equal((await client.portal.listCalls()).length, 1);

  const sourceText = `Reputation Tenability integration verification ${stamp}`;
  const uploaded = await client.portal.uploadDocument({ name: "integration-check.txt", contentBase64: Buffer.from(sourceText).toString("base64"), contentType: "text/plain", category: "other", caseId });
  fileKey = uploaded.key;
  assert.equal(await storage.fileExists({ fileKey }), true);
  assert.equal((await storage.headFile({ fileKey })).size, Buffer.byteLength(sourceText));
  assert((await storage.listFiles({ prefix: `u/${clientId}/`, delimiter: "" })).objects.some((item) => item.key === fileKey));
  assert.equal(Buffer.from(await storage.readFile({ fileKey })).toString(), sourceText);
  const secureUrl = await client.portal.documentUrl({ id: uploaded.id });
  const downloaded = await originalFetch(secureUrl.url);
  assert.equal(downloaded.ok, true);
  assert.equal(await downloaded.text(), sourceText);
  await expectError(staff.portal.documentUrl({ id: uploaded.id }), "NOT_FOUND");
  assert((await staff.portal.adminDocumentUrl({ id: uploaded.id })).url.startsWith("http"));

  await staff.portal.adminReviewDocument({ id: uploaded.id, staffSummary: "Integration review: source text preserved and ownership checks passed." });
  const reviewed = (await client.portal.listDocuments()).find((item) => item.id === uploaded.id);
  assert.equal(reviewed?.reviewStatus, "reviewed");
  assert.match(reviewed?.staffSummary ?? "", /source text preserved/);
  await expectError(client.portal.adminOverview(), "FORBIDDEN");
  assert((await staff.portal.adminOverview()).documents.some((item) => item.id === uploaded.id));

  await staff.portal.adminAddVideo({ title: videoTitle, description: "Temporary integration-check video record.", videoUrl: "https://example.com/education-check", category: "Test", duration: "1 minute" });
  assert((await client.portal.listVideos()).some((item) => item.title === videoTitle));

  const modelList = await listModels();
  assert(modelList.defaultModelId);
  const aiResult = await client.portal.askAssistant({ question: "What records should I gather to organize a factual credit-report dispute?" });
  assert(aiResult.answer || aiResult.unavailable);
  aiStatus = aiResult.answer ? "answered" : "degraded gracefully";
  if (aiResult.answer) assert.equal(attributionSeen, true);

  await client.portal.removeDocument({ id: uploaded.id });
  assert.equal(await storage.fileExists({ fileKey }), false);
  assert.equal((await client.portal.listDocuments()).length, 0);

  console.log(JSON.stringify({ status: "passed", checks: ["intake", "case CRUD", "call log", "cross-account case rejection", "private storage upload", "storage metadata/list/read/download", "staff document review", "admin permission boundary", "video publishing", "document deletion"], ai: aiStatus, discoveredModels: modelList.models.length, attributionHeader: attributionSeen }, null, 2));
  passed = true;
} catch (error) {
  console.error(error);
} finally {
  globalThis.fetch = originalFetch;
  if (fileKey) await storage.deleteFile({ fileKey }).catch(() => undefined);
  if (clientUser) {
    await db.delete(documents).where(eq(documents.userId, clientUser.id)).catch(() => undefined);
    await db.delete(callLogs).where(eq(callLogs.userId, clientUser.id)).catch(() => undefined);
    await db.delete(courtCases).where(eq(courtCases.userId, clientUser.id)).catch(() => undefined);
    await db.delete(clientProfiles).where(eq(clientProfiles.userId, clientUser.id)).catch(() => undefined);
  }
  await db.delete(videoLessons).where(eq(videoLessons.title, videoTitle)).catch(() => undefined);
  if (clientUser) await db.delete(users).where(eq(users.id, clientUser.id)).catch(() => undefined);
  if (adminUser) await db.delete(users).where(eq(users.id, adminUser.id)).catch(() => undefined);
  process.exit(passed ? 0 : 1);
}
