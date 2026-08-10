import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isValueSet,
  looseSettingsSchema,
  settingsSchema,
  SETTING_KEYS,
  type Settings,
  type SettingKey,
} from "./settings/schema.js";
import { readAll, writeMany } from "./settings/store.js";

// Loads .env from the repo root (no extra dependency).
function loadDotEnv() {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), "../..")]) {
    const file = path.join(dir, ".env");
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
}
loadDotEnv();

export type SettingSource = "db" | "env" | "default";

/** Values coming from environment variables (or .env), empty ones dropped. */
function envLayer(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const raw = process.env[key];
    if (isValueSet(key, raw)) out[key] = raw;
  }
  return out;
}

/** Values saved from the setup UI, empty ones dropped. */
function dbLayer(): Record<string, string> {
  const stored = readAll();
  const out: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const raw = stored[key];
    if (isValueSet(key, raw)) out[key] = raw;
  }
  return out;
}

/** Raw effective values, DB winning over env. Unset keys are simply absent. */
export function rawValues(): Record<string, string> {
  return { ...envLayer(), ...dbLayer() };
}

/** Where the effective value of a key comes from. */
export function sourceOf(key: SettingKey): SettingSource {
  if (isValueSet(key, dbLayer()[key])) return "db";
  if (isValueSet(key, envLayer()[key])) return "env";
  return "default";
}

/** True when the key has an explicit value somewhere (i.e. not just a default). */
export function isConfiguredKey(key: SettingKey): boolean {
  return sourceOf(key) !== "default";
}

/**
 * Effective configuration. Kept as a plain mutable object so consumers can hold
 * a single import and still read fresh values after a settings save.
 */
export const config: Settings = {} as Settings;

/** Keys that are missing or invalid for a fully working install. */
export const missingKeys: string[] = [];

/** Re-reads env + DB and refreshes `config` and `missingKeys` in place. */
export function reloadConfig(): void {
  const raw = rawValues();
  Object.assign(config, looseSettingsSchema.parse(raw));

  const strict = settingsSchema.safeParse(raw);
  missingKeys.length = 0;
  if (!strict.success) {
    for (const key of new Set(strict.error.issues.map((i) => String(i.path[0])))) {
      missingKeys.push(key);
    }
  }
}

/** True when every required setting is present and valid. */
export function isConfigured(): boolean {
  return missingKeys.length === 0;
}

/** The web password gate is only meaningful once a password exists. */
export function isPasswordConfigured(): boolean {
  return config.WEB_PASSWORD.length > 0;
}

reloadConfig();

// Sessions must survive restarts, so the auto-generated secret is persisted
// instead of living in memory. Never asked for in the UI.
if (config.WEB_SESSION_SECRET.length < 16) {
  writeMany({ WEB_SESSION_SECRET: randomBytes(32).toString("hex") });
  reloadConfig();
}
