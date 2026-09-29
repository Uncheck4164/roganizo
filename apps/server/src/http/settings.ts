import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  config,
  isConfigured,
  isPasswordConfigured,
  missingKeys,
  rawValues,
  reloadConfig,
  sourceOf,
} from "../config.js";
import {
  apiKeyFor,
  isEnvOnlyKey,
  isRequiredKey,
  isSecretKey,
  isSettingKey,
  isValueSet,
  UI_KEYS,
  validateOne,
  SETTINGS_META,
  type SettingKey,
} from "../settings/schema.js";
import { writeMany } from "../settings/store.js";
import { isBotRunning } from "../bot/bot.js";
import { hasSession, requireSession, setSessionCookie } from "./auth.js";

export const settingsRoutes = new Hono();

/**
 * Called by POST /api/settings/apply to release the HTTP port and the bot
 * before the process exits. Wired from index.ts, which owns both.
 */
type ShutdownHook = () => void | Promise<void>;
let shutdownHook: ShutdownHook | null = null;
export function onApplyRestart(hook: ShutdownHook): void {
  shutdownHook = hook;
}

/**
 * Settings are behind the session cookie, except while no web password exists
 * anywhere: that first-boot window is the only way to configure the app, and it
 * closes as soon as a password is saved.
 */
export async function requireSessionUnlessSetup(c: Context, next: Next) {
  if (!isPasswordConfigured()) return next();
  return requireSession(c, next);
}

settingsRoutes.use("/api/settings", requireSessionUnlessSetup);
settingsRoutes.use("/api/settings/*", requireSessionUnlessSetup);

/** Effective value of a key as a string (explicit value, else parsed default). */
function effectiveValue(key: SettingKey, raw: Record<string, string>): string {
  const explicit = raw[key];
  if (isValueSet(key, explicit)) return explicit;
  // Required keys have no real default — the loose-schema placeholder (0, "")
  // must not leak into the UI as if it were a value.
  if (isRequiredKey(key)) return "";
  return String(config[key]);
}

// Unauthenticated on purpose: the SPA needs it to decide between login and setup.
settingsRoutes.get("/setup/status", (c) =>
  c.json({
    setupRequired: !isConfigured(),
    passwordSet: isPasswordConfigured(),
    // With a password already set (e.g. from the environment) the setup screen
    // needs a login first, or /api/settings answers 401 and the form never loads.
    authenticated: hasSession(c),
    missing: [...missingKeys],
  }),
);

settingsRoutes.get("/api/settings", (c) => {
  const raw = rawValues();
  const values: Record<string, string> = {};
  const meta: Record<string, Record<string, unknown>> = {};

  for (const key of UI_KEYS) {
    const info = SETTINGS_META[key];
    const secret = isSecretKey(key);
    const configured = isValueSet(key, raw[key]);
    const value = effectiveValue(key, raw);
    values[key] = secret ? "" : value;
    meta[key] = {
      secret,
      configured,
      // Optional keys have a working default: only a required one without a
      // value is something the user still has to do. Of the two API keys, only
      // the active provider's one is.
      required: isRequiredKey(key) || key === apiKeyFor(config.LLM_PROVIDER),
      source: sourceOf(key),
      group: info.group,
      envOnly: info.envOnly,
      ...(secret && configured ? { hint: value.slice(-4) } : {}),
    };
  }

  return c.json({ setupRequired: !isConfigured(), values, meta });
});

settingsRoutes.put("/api/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { values?: Record<string, unknown> };
  const submitted = body.values;
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return c.json({ errors: { _: "Expected a body of the form { values: { KEY: string } }" } }, 400);
  }

  const errors: Record<string, string> = {};
  const patch: Record<string, string> = {};

  for (const [key, raw] of Object.entries(submitted)) {
    if (!isSettingKey(key) || !(key in SETTINGS_META)) {
      errors[key] = "Unknown setting";
      continue;
    }
    if (isEnvOnlyKey(key)) {
      errors[key] = "This setting can only be changed through the environment";
      continue;
    }
    if (typeof raw !== "string") {
      errors[key] = "Value must be a string";
      continue;
    }
    // Stored in canonical form: a trailing slash would put "//oauth/callback"
    // in the redirect URI and Google would reject it as a mismatch.
    const value = key === "PUBLIC_URL" ? raw.trim().replace(/\/+$/, "") : raw.trim();
    const check = validateOne(key, value);
    if (!check.ok) {
      errors[key] = check.message;
      continue;
    }
    patch[key] = value;
  }

  // All or nothing: a single invalid field leaves the stored config untouched.
  if (Object.keys(errors).length > 0) return c.json({ errors }, 400);

  const passwordWasSet = isPasswordConfigured();
  writeMany(patch);
  reloadConfig();

  // Saving the first password closes the setup trust window. Log the author of
  // that save in right away, or their very next request (e.g. apply) would 401.
  if (!passwordWasSet && isPasswordConfigured()) setSessionCookie(c);

  // Everything else is read from `config` at call time. The bot is the
  // exception: grammY binds its token at construction, and it only starts once
  // the configuration is complete — so until then there is nothing to restart,
  // even when the token changes mid-setup.
  const restartRequired =
    isConfigured() && (Object.keys(patch).includes("TELEGRAM_BOT_TOKEN") || !isBotRunning());
  return c.json({ ok: true, restartRequired, setupComplete: isConfigured() });
});

settingsRoutes.post("/api/settings/apply", (c) => {
  // The supervisor (Docker, systemd, tsx watch) brings the process back up with
  // the new configuration; there is no in-place reload of the bot/scheduler.
  setTimeout(() => {
    void (async () => {
      try {
        await shutdownHook?.();
      } catch (err) {
        console.error("Error during restart shutdown:", err);
      }
      process.exit(0);
    })();
  }, 300);
  return c.json({ ok: true });
});
