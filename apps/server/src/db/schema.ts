import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reminders = sqliteTable("reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  message: text("message").notNull(),
  // ISO 8601 with offset; the scheduler compares it against "now"
  fireAt: text("fire_at").notNull(),
  firedAt: text("fired_at"),
  createdAt: text("created_at").notNull(),
  // Urgent escalation: retries every 5 min and a phone call if unacknowledged
  urgent: integer("urgent").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: text("last_attempt_at"),
  ackedAt: text("acked_at"),
});

// Large operations waiting for Confirm/Cancel through inline buttons
export const pendingActions = sqliteTable("pending_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // JSON: [{ tool, args }, ...]
  actionsJson: text("actions_json").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | expired
  createdAt: text("created_at").notNull(),
});

export const googleTokens = sqliteTable("google_tokens", {
  id: integer("id").primaryKey(), // always 1: single-user app
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiry: text("access_token_expiry"),
  updatedAt: text("updated_at").notNull(),
});

export const chatHistory = sqliteTable("chat_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(), // user | assistant | tool
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  // Full message in OpenAI format (including tool_calls and their results).
  // Without it the model only saw "request -> success text" and learned to skip
  // the tools while claiming it had already run them.
  payload: text("payload"),
});

// Settings saved from the web UI. They win over environment variables; keys
// absent here fall back to env and then to the zod defaults.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
