import { z } from "zod";

/**
 * Single source of truth for every configuration key of the app.
 *
 * The effective value of a key is resolved as: DB row (saved from the UI) >
 * environment variable > zod default. Environment values are never copied into
 * the DB; only explicit saves from the setup UI write rows.
 */
export const settingsSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int(),
  OPENROUTER_API_KEY: z.string().min(10),
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-v4-flash-0731"),
  // OpenRouter provider slugs in order of preference (a quantization variant is
  // allowed, e.g. "deepinfra/fp4"). Empty = let OpenRouter choose.
  OPENROUTER_PROVIDER_ORDER: z.string().default("deepinfra/fp4,baidu"),
  // "price" = always the cheapest available option when falling back.
  OPENROUTER_SORT: z.enum(["price", "throughput", "latency"]).default("price"),
  GOOGLE_CLIENT_ID: z.string().min(5),
  GOOGLE_CLIENT_SECRET: z.string().min(5),
  PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  PORT: z.coerce.number().int().default(8080),
  WEB_PASSWORD: z.string().min(4),
  WEB_SESSION_SECRET: z.string().min(16),
  TIMEZONE: z.string().default("America/Santiago"),
  // Telegram username (@user) used for CallMeBot phone calls on unacknowledged
  // urgent reminders. Empty = no calls (message retries only).
  CALLMEBOT_USER: z.string().default(""),
  BRIEFING_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .or(z.literal(""))
    .default("07:30"),
  DATABASE_PATH: z.string().default("./data/roganizo.db"),
  // Language of every user-facing string (bot messages, briefing, agent replies).
  LANGUAGE: z.enum(["es", "en"]).default("es"),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

/**
 * Same shape as `settingsSchema`, but it can never fail: required fields fall
 * back to an "empty" value and invalid input is caught instead of thrown. The
 * app always boots — an incomplete config lands in browser setup mode.
 */
export const looseSettingsSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().default("").catch(""),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().default(0).catch(0),
  OPENROUTER_API_KEY: z.string().default("").catch(""),
  OPENROUTER_MODEL: z
    .string()
    .default("deepseek/deepseek-v4-flash-0731")
    .catch("deepseek/deepseek-v4-flash-0731"),
  OPENROUTER_PROVIDER_ORDER: z.string().default("deepinfra/fp4,baidu").catch("deepinfra/fp4,baidu"),
  OPENROUTER_SORT: z.enum(["price", "throughput", "latency"]).default("price").catch("price"),
  GOOGLE_CLIENT_ID: z.string().default("").catch(""),
  GOOGLE_CLIENT_SECRET: z.string().default("").catch(""),
  PUBLIC_URL: z
    .string()
    .url()
    .default("http://localhost:8080")
    .catch("http://localhost:8080"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080).catch(8080),
  WEB_PASSWORD: z.string().default("").catch(""),
  WEB_SESSION_SECRET: z.string().default("").catch(""),
  TIMEZONE: z.string().default("America/Santiago").catch("America/Santiago"),
  CALLMEBOT_USER: z.string().default("").catch(""),
  BRIEFING_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .or(z.literal(""))
    .default("07:30")
    .catch("07:30"),
  DATABASE_PATH: z.string().default("./data/roganizo.db").catch("./data/roganizo.db"),
  LANGUAGE: z.enum(["es", "en"]).default("es").catch("es"),
});

export type LooseSettings = z.infer<typeof looseSettingsSchema>;

// Compile-time guard: both schemas must produce exactly the same value shape,
// otherwise `config.X` would change type depending on which one parsed.
type SameShape<A, B> = A extends B ? (B extends A ? true : never) : never;
const _shapesMatch: SameShape<Settings, LooseSettings> = true;
void _shapesMatch;

/** Every key the app knows about, in UI display order. */
export const SETTING_KEYS = Object.keys(settingsSchema.shape) as SettingKey[];

/** Values that must never travel back to the browser. */
export const SECRET_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "WEB_PASSWORD",
] as const;

/** Configurable through the environment only (it locates the DB itself). */
export const ENV_ONLY_KEYS = ["DATABASE_PATH"] as const;

/** Managed by the app, never shown nor editable in the UI. */
export const HIDDEN_KEYS = ["WEB_SESSION_SECRET"] as const;

/**
 * Keys with no usable default: until the user provides them the UI must show an
 * empty input, not the loose-schema placeholder (0, "").
 */
export const REQUIRED_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USER_ID",
  "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "WEB_PASSWORD",
] as const;

export function isRequiredKey(key: string): boolean {
  return (REQUIRED_KEYS as readonly string[]).includes(key);
}

/**
 * Keys where an empty string is a meaningful value ("disabled") rather than
 * "not set"; every other empty value falls through to the next layer.
 */
export const EMPTY_ALLOWED_KEYS = ["CALLMEBOT_USER", "BRIEFING_TIME"] as const;

export type SettingGroup = "telegram" | "model" | "google" | "server" | "web" | "preferences";

export interface SettingMeta {
  group: SettingGroup;
  secret: boolean;
  envOnly: boolean;
}

/** UI metadata. WEB_SESSION_SECRET is deliberately absent: it is never exposed. */
export const SETTINGS_META: Record<Exclude<SettingKey, "WEB_SESSION_SECRET">, SettingMeta> = {
  TELEGRAM_BOT_TOKEN: { group: "telegram", secret: true, envOnly: false },
  TELEGRAM_ALLOWED_USER_ID: { group: "telegram", secret: false, envOnly: false },
  CALLMEBOT_USER: { group: "telegram", secret: false, envOnly: false },
  OPENROUTER_API_KEY: { group: "model", secret: true, envOnly: false },
  OPENROUTER_MODEL: { group: "model", secret: false, envOnly: false },
  OPENROUTER_PROVIDER_ORDER: { group: "model", secret: false, envOnly: false },
  OPENROUTER_SORT: { group: "model", secret: false, envOnly: false },
  GOOGLE_CLIENT_ID: { group: "google", secret: false, envOnly: false },
  GOOGLE_CLIENT_SECRET: { group: "google", secret: true, envOnly: false },
  PUBLIC_URL: { group: "server", secret: false, envOnly: false },
  PORT: { group: "server", secret: false, envOnly: false },
  DATABASE_PATH: { group: "server", secret: false, envOnly: true },
  WEB_PASSWORD: { group: "web", secret: true, envOnly: false },
  TIMEZONE: { group: "preferences", secret: false, envOnly: false },
  LANGUAGE: { group: "preferences", secret: false, envOnly: false },
  BRIEFING_TIME: { group: "preferences", secret: false, envOnly: false },
};

/** Keys exposed to the UI, grouped-display order included. */
export const UI_KEYS = Object.keys(SETTINGS_META) as Exclude<SettingKey, "WEB_SESSION_SECRET">[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(settingsSchema.shape, key);
}

export function isSecretKey(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export function isEnvOnlyKey(key: string): boolean {
  return (ENV_ONLY_KEYS as readonly string[]).includes(key);
}

export function isHiddenKey(key: string): boolean {
  return (HIDDEN_KEYS as readonly string[]).includes(key);
}

/**
 * Whether a raw value counts as "provided" by a layer. An empty string means
 * "not set" for everything except the keys where empty is a real choice.
 */
export function isValueSet(key: string, value: string | undefined): value is string {
  if (value === undefined) return false;
  if (value !== "") return true;
  return (EMPTY_ALLOWED_KEYS as readonly string[]).includes(key);
}

/** Validates one submitted value against the strict shape of its key. */
export function validateOne(
  key: SettingKey,
  value: string,
): { ok: true } | { ok: false; message: string } {
  const field = settingsSchema.shape[key] as z.ZodTypeAny;
  const result = field.safeParse(value);
  if (result.success) return { ok: true };
  return { ok: false, message: result.error.issues[0]?.message ?? "Invalid value" };
}
