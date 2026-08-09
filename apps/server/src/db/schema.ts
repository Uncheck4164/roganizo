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
  // ISO 8601 con offset; el scheduler compara contra "ahora"
  fireAt: text("fire_at").notNull(),
  firedAt: text("fired_at"),
  createdAt: text("created_at").notNull(),
  // Escalado de urgentes: reintentos cada 5 min y llamada si no se confirma
  urgent: integer("urgent").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: text("last_attempt_at"),
  ackedAt: text("acked_at"),
});

// Operaciones grandes esperando Confirmar/Cancelar por botones inline
export const pendingActions = sqliteTable("pending_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // JSON: [{ tool, args }, ...]
  actionsJson: text("actions_json").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | expired
  createdAt: text("created_at").notNull(),
});

export const googleTokens = sqliteTable("google_tokens", {
  id: integer("id").primaryKey(), // siempre 1: mono-usuario
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiry: text("access_token_expiry"),
  updatedAt: text("updated_at").notNull(),
});

export const chatHistory = sqliteTable("chat_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});
