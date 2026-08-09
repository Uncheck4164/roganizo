import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { config } from "../config.js";

const COOKIE = "roganizo_session";
const MAX_AGE_DAYS = 30;

function sign(payload: string): string {
  return createHmac("sha256", config.WEB_SESSION_SECRET).update(payload).digest("hex");
}

export function makeSessionToken(): string {
  const payload = String(Date.now());
  return `${payload}.${sign(payload)}`;
}

export function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = Date.now() - Number(payload);
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE_DAYS * 24 * 3600 * 1000;
}

export function setSessionCookie(c: Context) {
  setCookie(c, COOKIE, makeSessionToken(), {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.PUBLIC_URL.startsWith("https"),
    maxAge: MAX_AGE_DAYS * 24 * 3600,
    path: "/",
  });
}

export async function requireSession(c: Context, next: Next) {
  if (!isValidToken(getCookie(c, COOKIE))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}
