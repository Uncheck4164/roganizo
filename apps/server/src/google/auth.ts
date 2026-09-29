import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
];

/**
 * The exact URI to register in Google Cloud. Computed on every use, not at
 * import: settings apply without a restart now, PUBLIC_URL included.
 */
export function redirectUri(): string {
  return `${config.PUBLIC_URL}/oauth/callback`;
}

function newClient() {
  return new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, redirectUri());
}

export function isGoogleClientConfigured(): boolean {
  return config.GOOGLE_CLIENT_ID.length >= 5 && config.GOOGLE_CLIENT_SECRET.length >= 5;
}

/** Pending logins: state → where to send the browser back. Short-lived. */
const STATE_TTL_MS = 15 * 60 * 1000;
const pendingStates = new Map<string, { returnTo: "setup" | "bot"; expires: number }>();

/**
 * The `state` ties the callback to a login this server started, so a
 * forged callback cannot plant someone else's Google account.
 */
export function getAuthUrl(returnTo: "setup" | "bot" = "bot"): string {
  const now = Date.now();
  for (const [key, entry] of pendingStates) if (entry.expires < now) pendingStates.delete(key);
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, { returnTo, expires: now + STATE_TTL_MS });
  return newClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

/** Consumes a state once; undefined when unknown or expired. */
export function consumeState(state: string | undefined): "setup" | "bot" | undefined {
  if (!state) return undefined;
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  return entry && entry.expires >= Date.now() ? entry.returnTo : undefined;
}

export async function handleOAuthCallback(code: string): Promise<void> {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google no devolvió refresh_token. Revocá el acceso en https://myaccount.google.com/permissions y reintentá.",
    );
  }
  const now = new Date().toISOString();
  db.insert(schema.googleTokens)
    .values({ id: 1, refreshToken: tokens.refresh_token, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.googleTokens.id,
      set: { refreshToken: tokens.refresh_token, updatedAt: now },
    })
    .run();
}

export function isGoogleConnected(): boolean {
  return (
    db.select().from(schema.googleTokens).where(eq(schema.googleTokens.id, 1)).get() !==
    undefined
  );
}

/** Authenticated client; googleapis refreshes the access token on its own. */
export function getAuthedClient() {
  const row = db
    .select()
    .from(schema.googleTokens)
    .where(eq(schema.googleTokens.id, 1))
    .get();
  if (!row) {
    throw new Error("Google no está conectado todavía. Usá /start en el bot.");
  }
  const client = newClient();
  client.setCredentials({ refresh_token: row.refreshToken });
  return client;
}

/**
 * Reads one item from each API. A stored token only proves a login happened
 * once; this proves both APIs are enabled and the token still works.
 */
export async function checkGoogleAccess(): Promise<{ calendar: string; tasks: string }> {
  const auth = getAuthedClient();
  const describe = (err: unknown) => {
    const message = (err as Error).message;
    return /has not been used|is disabled|accessNotConfigured/i.test(message)
      ? `API desactivada en Google Cloud: ${message}`
      : message;
  };
  const [calendar, tasks] = await Promise.all([
    google
      .calendar({ version: "v3", auth })
      .calendarList.list({ maxResults: 1 })
      .then(() => "ok", describe),
    google
      .tasks({ version: "v1", auth })
      .tasklists.list({ maxResults: 1 })
      .then(() => "ok", describe),
  ]);
  return { calendar, tasks };
}
