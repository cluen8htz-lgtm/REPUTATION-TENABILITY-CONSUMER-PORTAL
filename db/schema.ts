import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  int,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export const clientProfiles = mysqlTable("clientProfiles", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique(),
  phone: varchar("phone", { length: 40 }),
  state: varchar("state", { length: 2 }),
  county: varchar("county", { length: 80 }),
  serviceInterest: varchar("serviceInterest", { length: 80 }),
  contactPreference: varchar("contactPreference", { length: 30 }),
  intakeNotes: text("intakeNotes"),
  intakeCompleted: boolean("intakeCompleted").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const courtCases = mysqlTable("courtCases", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  plaintiff: varchar("plaintiff", { length: 255 }).notNull(),
  defendant: varchar("defendant", { length: 255 }).notNull(),
  court: varchar("court", { length: 255 }),
  state: varchar("state", { length: 2 }).notNull(),
  county: varchar("county", { length: 80 }).notNull(),
  caseNumber: varchar("caseNumber", { length: 120 }),
  caseType: varchar("caseType", { length: 80 }).default("Debt collection").notNull(),
  status: mysqlEnum("status", ["needs_review", "active", "closed"]).default("needs_review").notNull(),
  filedOn: varchar("filedOn", { length: 10 }),
  servedOn: varchar("servedOn", { length: 10 }),
  nextDeadline: varchar("nextDeadline", { length: 10 }),
  deadlineLabel: varchar("deadlineLabel", { length: 120 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const documents = mysqlTable("documents", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  caseId: bigint("caseId", { mode: "number", unsigned: true }),
  fileKey: varchar("fileKey", { length: 700 }).notNull().unique(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  contentType: varchar("contentType", { length: 180 }),
  size: int("size").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  folder: varchar("folder", { length: 120 }).notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["pending", "reviewed"]).default("pending").notNull(),
  staffSummary: text("staffSummary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const callLogs = mysqlTable("callLogs", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  caseId: bigint("caseId", { mode: "number", unsigned: true }),
  collectorName: varchar("collectorName", { length: 255 }).notNull(),
  phoneNumber: varchar("phoneNumber", { length: 40 }),
  calledAt: varchar("calledAt", { length: 25 }).notNull(),
  direction: mysqlEnum("direction", ["incoming", "outgoing"]).default("incoming").notNull(),
  summary: text("summary").notNull(),
  notes: text("notes"),
  consentAcknowledged: boolean("consentAcknowledged").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const videoLessons = mysqlTable("videoLessons", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  videoUrl: varchar("videoUrl", { length: 1000 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  duration: varchar("duration", { length: 30 }),
  published: boolean("published").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* ===== MODULE 1 — FCBA Billing Error ===== */

export const fcbaStatements = mysqlTable("fcbaStatements", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  fileKey: varchar("fileKey", { length: 700 }).notNull().unique(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  exhibitLabel: varchar("exhibitLabel", { length: 20 }).notNull(),
  category: varchar("category", { length: 40 }).notNull(),
  folder: varchar("folder", { length: 120 }).notNull(),
  cycle: varchar("cycle", { length: 40 }),
  isFirstStatement: boolean("isFirstStatement").default(false).notNull(),
  analysisStatus: mysqlEnum("analysisStatus", ["pending", "analyzing", "complete", "failed"]).default("pending").notNull(),
  annotatedFileKey: varchar("annotatedFileKey", { length: 700 }),
  complianceScore: int("complianceScore"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const fcbaViolations = mysqlTable("fcbaViolations", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  statementId: bigint("statementId", { mode: "number", unsigned: true }).notNull(),
  ruleId: varchar("ruleId", { length: 20 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  statute: varchar("statute", { length: 255 }).notNull(),
  severity: mysqlEnum("severity", ["critical", "major", "minor"]).notNull(),
  excerpt: text("excerpt").notNull(),
  annotation: text("annotation").notNull(),
  mark: varchar("mark", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const fcbaDisputes = mysqlTable("fcbaDisputes", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  creditorName: varchar("creditorName", { length: 255 }).notNull(),
  accountLast4: varchar("accountLast4", { length: 20 }).notNull(),
  noticeType: mysqlEnum("noticeType", ["billing_error", "noncompliance_notice", "arbitration_demand"]).notNull(),
  summary: text("summary").notNull(),
  status: mysqlEnum("status", ["open", "acknowledged", "escalated", "resolved", "arbitration"]).default("open").notNull(),
  creditorReceivedDate: varchar("creditorReceivedDate", { length: 25 }),
  sentVia: varchar("sentVia", { length: 60 }),
  trackingNumbers: varchar("trackingNumbers", { length: 300 }),
  ackDeadline: varchar("ackDeadline", { length: 30 }),
  resolveDeadline: varchar("resolveDeadline", { length: 30 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const fcbaEvents = mysqlTable("fcbaEvents", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  statementId: bigint("statementId", { mode: "number", unsigned: true }),
  disputeId: bigint("disputeId", { mode: "number", unsigned: true }),
  type: varchar("type", { length: 40 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* ===== MODULE 2 — Repossession ===== */

export const repoCases = mysqlTable("repoCases", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  creditorName: varchar("creditorName", { length: 255 }).notNull(),
  repoAgencyName: varchar("repoAgencyName", { length: 255 }),
  vehicle: varchar("vehicle", { length: 255 }).notNull(),
  vin: varchar("vin", { length: 30 }),
  state: mysqlEnum("state", ["FL", "CA"]).notNull(),
  repossessionDate: varchar("repossessionDate", { length: 25 }),
  saleDate: varchar("saleDate", { length: 25 }),
  rcSignDate: varchar("rcSignDate", { length: 25 }),
  status: mysqlEnum("status", ["intake", "demand_sent", "analyzed", "drafted", "arbitration", "resolved"]).default("intake").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const repoDocuments = mysqlTable("repoDocuments", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  caseId: bigint("caseId", { mode: "number", unsigned: true }),
  fileKey: varchar("fileKey", { length: 700 }).notNull().unique(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  exhibitLabel: varchar("exhibitLabel", { length: 20 }).notNull(),
  docType: mysqlEnum("docType", ["contract", "notice_611", "notice_613", "notice_616", "default_notice", "notice_of_sale", "ucc1", "prospectus_424b5", "report_10k", "report_8k", "sales_servicing_agreement", "pacer_case", "dmv_title", "repo_work_order", "other"]).notNull(),
  analysisStatus: mysqlEnum("analysisStatus", ["pending", "analyzing", "complete", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const repoViolations = mysqlTable("repoViolations", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  caseId: bigint("caseId", { mode: "number", unsigned: true }).notNull(),
  ruleId: varchar("ruleId", { length: 20 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  statute: varchar("statute", { length: 255 }).notNull(),
  severity: mysqlEnum("severity", ["critical", "major", "minor"]).notNull(),
  excerpt: text("excerpt").notNull(),
  annotation: text("annotation").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const repoEvents = mysqlTable("repoEvents", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  caseId: bigint("caseId", { mode: "number", unsigned: true }),
  documentId: bigint("documentId", { mode: "number", unsigned: true }),
  type: varchar("type", { length: 40 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ClientProfile = typeof clientProfiles.$inferSelect;
export type CourtCase = typeof courtCases.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
export type CallLog = typeof callLogs.$inferSelect;
export type VideoLesson = typeof videoLessons.$inferSelect;
