import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { callLogs, clientProfiles, courtCases, documents, users, videoLessons } from "../db/schema";
import { signSessionToken } from "../api/kimi/session";
import { storage } from "../api/lib/storage";

const statePath = "/tmp/reputation-browser-check.json";
const action = process.argv[2];
const db = getDb();

if (action === "create") {
  const unionId = `browser-check-${Date.now()}`;
  const [{ id }] = await db.insert(users).values({ unionId, name: "Portal Browser Check", email: "browser@example.test", role: "admin" }).$returningId();
  const token = await signSessionToken({ unionId, clientId: process.env.APP_ID! });
  writeFileSync(statePath, JSON.stringify({ id, unionId, token }), { mode: 0o600 });
  console.log(token);
} else if (action === "cleanup") {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as { id: number; unionId: string };
  const uploaded = await db.select().from(documents).where(eq(documents.userId, state.id));
  for (const item of uploaded) await storage.deleteFile({ fileKey: item.fileKey });
  await db.delete(documents).where(eq(documents.userId, state.id));
  await db.delete(callLogs).where(eq(callLogs.userId, state.id));
  await db.delete(courtCases).where(eq(courtCases.userId, state.id));
  await db.delete(clientProfiles).where(eq(clientProfiles.userId, state.id));
  await db.delete(videoLessons).where(eq(videoLessons.title, "Browser verification class"));
  await db.delete(users).where(eq(users.id, state.id));
  console.log("Browser verification records removed");
} else {
  throw new Error("Use create or cleanup");
}
process.exit(0);
