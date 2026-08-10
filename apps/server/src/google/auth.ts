import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
];

const REDIRECT_URI = `${config.PUBLIC_URL}/oauth/callback`;

function newClient() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

export function getAuthUrl(): string {
  return newClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
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
