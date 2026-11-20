import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb } from "../queries/connection";
import { log } from "./logger";

/**
 * Apply pending SQL migrations from db/migrations at startup, so a fresh
 * deploy needs no separate migration step. Disable with RUN_MIGRATIONS=false.
 * Drizzle records applied migrations in __drizzle_migrations, so re-runs are no-ops.
 */
export async function runMigrations() {
  if (process.env.RUN_MIGRATIONS === "false") return;
  const migrationsFolder = path.resolve(process.cwd(), "db/migrations");
  const started = Date.now();
  await migrate(getDb(), { migrationsFolder });
  log.info("database migrations up to date", { durationMs: Date.now() - started });
}
