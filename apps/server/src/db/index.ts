import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

fs.mkdirSync(path.dirname(path.resolve(config.DATABASE_PATH)), { recursive: true });

const sqlite = new Database(config.DATABASE_PATH);
sqlite.pragma("journal_mode = WAL");

// Idempotent bootstrap: for a single-user app plain DDL is enough, no migration
// pipeline needed.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  fired_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actions_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS google_tokens (
  id INTEGER PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expiry TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Columns added after the first release: idempotent ALTERs.
for (const ddl of [
  "ALTER TABLE reminders ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE reminders ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE reminders ADD COLUMN last_attempt_at TEXT",
  "ALTER TABLE reminders ADD COLUMN acked_at TEXT",
  "ALTER TABLE chat_history ADD COLUMN payload TEXT",
  "ALTER TABLE pending_actions ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE pending_actions ADD COLUMN chat_id TEXT",
  "ALTER TABLE pending_actions ADD COLUMN message_id INTEGER",
]) {
  try {
    sqlite.exec(ddl);
  } catch {
    // the column already exists
  }
}

export const db = drizzle(sqlite, { schema });
export { schema };
