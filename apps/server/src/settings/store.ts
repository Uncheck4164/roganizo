import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Persistence for settings edited from the web UI.
 *
 * Deliberately standalone: it owns its own better-sqlite3 handle and resolves
 * DATABASE_PATH from the environment instead of importing config.ts or
 * db/index.ts, which would create an import cycle (config depends on this).
 */

export const DEFAULT_DATABASE_PATH = "./data/roganizo.db";

type Conn = InstanceType<typeof Database>;

let conn: Conn | null = null;

/** Effective DB file: env var only, since it is what locates the DB itself. */
export function databaseFile(): string {
  const fromEnv = process.env.DATABASE_PATH?.trim();
  return fromEnv ? fromEnv : DEFAULT_DATABASE_PATH;
}

/** Opened lazily so that .env is already loaded by the time we resolve the path. */
function db(): Conn {
  if (conn) return conn;
  const file = databaseFile();
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const opened = new Database(file);
  opened.pragma("journal_mode = WAL");
  opened.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
  conn = opened;
  return opened;
}

/** Every stored row as a plain key → value map. */
export function readAll(): Record<string, string> {
  const rows = db().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function readOne(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** Upserts every entry of the patch in a single transaction (all or nothing). */
export function writeMany(patch: Record<string, string>): void {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  const updatedAt = new Date().toISOString();
  const handle = db();
  const stmt = handle.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  handle.transaction((rows: [string, string][]) => {
    for (const [key, value] of rows) stmt.run(key, value, updatedAt);
  })(entries);
}
