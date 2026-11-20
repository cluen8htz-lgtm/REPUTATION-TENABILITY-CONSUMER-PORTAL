import { oauthEndpoints } from "./oauth-env";
import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

const DEV_SECRET = "dev-only-insecure-session-secret-change-me";

/**
 * Central configuration. Only APP_SECRET and DATABASE_URL are mandatory in
 * production; every managed service (Kimi OAuth, object storage, Claude) is
 * optional and the portal degrades gracefully when one is absent.
 */
export const env = {
  isProduction,
  appId: optional("APP_ID", "reputation-tenability"),
  appSecret: isProduction ? required("APP_SECRET") : optional("APP_SECRET", DEV_SECRET),
  databaseUrl: required("DATABASE_URL"),
  publicUrl: optional("PUBLIC_URL"),

  // Accounts
  ownerUnionId: optional("OWNER_UNION_ID"),
  ownerEmails: optional("OWNER_EMAIL")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  allowRegistration: optional("ALLOW_REGISTRATION", "true") !== "false",

  // Optional Kimi OAuth (legacy platform login)
  kimiAuthUrl: oauthEndpoints.KIMI_AUTH_URL ?? optional("KIMI_AUTH_URL"),
  kimiOpenUrl: oauthEndpoints.KIMI_OPEN_URL ?? optional("KIMI_OPEN_URL"),

  // Storage driver: local | s3 | kimi (auto-detected when unset)
  storageDriver: optional("STORAGE_DRIVER"),
  storageDir: optional("STORAGE_DIR", "./.data/uploads"),
  s3Bucket: optional("S3_BUCKET"),
  s3Region: optional("S3_REGION", "us-east-1"),
  s3Endpoint: optional("S3_ENDPOINT"),

  // Claude (AI analysis + drafting). Credentials resolve through the SDK.
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-opus-5-5"),
  aiDisabled: optional("AI_DISABLED") === "true",
};

export const usingDevSecret = env.appSecret === DEV_SECRET;
export const kimiOAuthEnabled = Boolean(env.kimiAuthUrl && env.kimiOpenUrl);
