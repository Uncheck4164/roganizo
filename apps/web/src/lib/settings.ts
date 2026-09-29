// Settings/setup contract with the server, plus the client-side field schema
// (order, input kind, options) and the bilingual step-by-step help content.
import { fetchJson } from "./api";
import type { Lang } from "./i18n";

export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

export type SettingsGroupKey = "telegram" | "model" | "google" | "server" | "web" | "preferences";

export interface SettingsFieldMeta {
  secret: boolean;
  configured: boolean;
  source: "db" | "env" | "default";
  group: SettingsGroupKey;
  /** For secrets: the last 4 characters of the stored value. */
  hint?: string;
  /** Values that can only come from the environment are rendered read-only. */
  envOnly?: boolean;
  /** Optional keys have a usable default; only these count as still missing. */
  required?: boolean;
}

export interface SettingsPayload {
  setupRequired: boolean;
  values: Record<string, string>;
  meta: Record<string, SettingsFieldMeta>;
}

export interface SetupStatus {
  setupRequired: boolean;
  passwordSet: boolean;
  authenticated: boolean;
  missing: string[];
}

export interface SaveResult {
  ok: boolean;
  restartRequired: boolean;
  setupComplete: boolean;
}

/** 400 from PUT /api/settings: one message per rejected key. */
export class SettingsValidationError extends Error {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super("invalid settings");
    this.name = "SettingsValidationError";
    this.errors = errors;
  }
}

export function fetchSetupStatus(): Promise<SetupStatus> {
  return fetchJson<SetupStatus>("/setup/status");
}

export function fetchSettings(): Promise<SettingsPayload> {
  return fetchJson<SettingsPayload>("/api/settings");
}

export type TelegramCheckResult =
  | { ok: true; username: string; name: string }
  | { ok: false; error: string };

export type TelegramLinkResult =
  | { ok: true; link: string; username: string; expiresAt: string }
  | { ok: false; error: string };

export interface TelegramLinkStatus {
  status: "idle" | "waiting" | "linked" | "expired" | "error";
  userId?: number;
  name?: string;
  error?: string;
}

export type LlmCheckResult =
  | { ok: true; provider: string; model: string; latencyMs: number }
  | { ok: false; model: string; error: string };

export interface GoogleSetupInfo {
  redirectUri: string;
  clientConfigured: boolean;
  connected: boolean;
}

export interface GoogleCheckResult {
  ok: boolean;
  calendar: "ok" | string;
  tasks: "ok" | string;
}

async function postSetup<T>(url: string): Promise<T> {
  if (IS_DEMO) {
    const { demoFetch } = await import("./demo");
    return demoFetch<T>(url === "/api/setup/telegram/link" ? `${url}?action=start` : url);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || body === null) throw new Error(`${url}: HTTP ${res.status}`);
  return body;
}

export function checkTelegram(): Promise<TelegramCheckResult> {
  return postSetup<TelegramCheckResult>("/api/setup/telegram/check");
}

export function startTelegramLink(): Promise<TelegramLinkResult> {
  return postSetup<TelegramLinkResult>("/api/setup/telegram/link");
}

export function fetchTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  return fetchJson<TelegramLinkStatus>("/api/setup/telegram/link");
}

export function checkLlm(): Promise<LlmCheckResult> {
  return postSetup<LlmCheckResult>("/api/setup/llm/check");
}

export function fetchGoogleSetup(): Promise<GoogleSetupInfo> {
  return fetchJson<GoogleSetupInfo>("/api/setup/google");
}

export function checkGoogle(): Promise<GoogleCheckResult> {
  return postSetup<GoogleCheckResult>("/api/setup/google/check");
}

/** Sends only the keys the user actually edited. */
export async function saveSettings(values: Record<string, string>): Promise<SaveResult> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
    credentials: "same-origin",
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { errors?: Record<string, string> } | null;
    throw new SettingsValidationError(body?.errors ?? {});
  }
  if (!res.ok) throw new Error(`PUT /api/settings: HTTP ${res.status}`);
  return (await res.json()) as SaveResult;
}

/** The process exits right after answering; Docker brings it back up. */
export async function applySettings(): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/settings/apply", { method: "POST", credentials: "same-origin" });
  } catch {
    // The process may die before answering — that is the expected case.
    return;
  }
  if (!res.ok) throw new Error(`POST /api/settings/apply: HTTP ${res.status}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls /health until the restarted process answers again. Waits a grace period
 * first so we do not mistake the still-alive old process for the new one.
 */
export async function waitForHealth(timeoutMs = 90_000): Promise<boolean> {
  await sleep(2500);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/health", { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* still down */
    }
    await sleep(1200);
  }
  return false;
}

export interface SettingsFieldDef {
  key: string;
  group: SettingsGroupKey;
  kind?: "text" | "time" | "select" | "datalist";
  options?: string[];
  placeholder?: string;
  /** Shown only while LLM_PROVIDER has this value. */
  provider?: LlmProvider;
}

export type LlmProvider = "openrouter" | "openai";

/** The provider the form currently points at (saved or just picked). */
export function activeProvider(value: string | undefined): LlmProvider {
  return value === "openai" ? "openai" : "openrouter";
}

/** Of the two API keys, only the active provider's one is required. */
export function apiKeyFor(provider: LlmProvider): string {
  return provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
}

export const GROUP_ORDER: SettingsGroupKey[] = [
  "telegram",
  "model",
  "google",
  "server",
  "web",
  "preferences",
];

/** Hues taken from the "Roganizo Web A" design, one per settings group. */
export const GROUP_HUE: Record<SettingsGroupKey, number> = {
  telegram: 198,
  model: 285,
  google: 32,
  server: 155,
  web: 338,
  preferences: 118,
};

const COMMON_TIMEZONES = [
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Mexico_City",
  "America/Lima",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Berlin",
  "UTC",
];

export const SETTINGS_FIELDS: SettingsFieldDef[] = [
  { key: "TELEGRAM_BOT_TOKEN", group: "telegram" },
  { key: "TELEGRAM_ALLOWED_USER_ID", group: "telegram" },
  { key: "CALLMEBOT_USER", group: "telegram", placeholder: "@usuario" },
  { key: "LLM_PROVIDER", group: "model", kind: "select", options: ["openrouter", "openai"] },
  { key: "OPENAI_API_KEY", group: "model", provider: "openai" },
  {
    key: "OPENAI_MODEL",
    group: "model",
    provider: "openai",
    kind: "datalist",
    options: ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra"],
  },
  {
    key: "OPENAI_MODEL_STRONG",
    group: "model",
    provider: "openai",
    kind: "datalist",
    options: ["gpt-6.1-sol", "gpt-6-astra"],
    placeholder: "gpt-6.1-sol",
  },
  {
    key: "OPENAI_REASONING_EFFORT",
    group: "model",
    provider: "openai",
    kind: "select",
    options: ["none", "low", "medium", "high"],
  },
  { key: "OPENROUTER_API_KEY", group: "model", provider: "openrouter" },
  { key: "OPENROUTER_MODEL", group: "model", provider: "openrouter" },
  { key: "OPENROUTER_MODEL_STRONG", group: "model", provider: "openrouter", placeholder: "anthropic/claude-sonnet-5" },
  {
    key: "OPENROUTER_QUALITY_FLOOR",
    group: "model",
    provider: "openrouter",
    kind: "select",
    options: ["any", "6bit", "8bit", "16bit"],
  },
  { key: "OPENROUTER_MAX_PRICE", group: "model", provider: "openrouter", placeholder: "0.2,0.6" },
  { key: "OPENROUTER_PROVIDER_ORDER", group: "model", provider: "openrouter", placeholder: "deepinfra,baidu" },
  {
    key: "OPENROUTER_SORT",
    group: "model",
    provider: "openrouter",
    kind: "select",
    options: ["auto", "price", "throughput", "latency"],
  },
  { key: "GOOGLE_CLIENT_ID", group: "google" },
  { key: "GOOGLE_CLIENT_SECRET", group: "google" },
  { key: "PUBLIC_URL", group: "server", placeholder: "https://roganizo.example.com" },
  { key: "PORT", group: "server", placeholder: "8080" },
  { key: "DATABASE_PATH", group: "server", placeholder: "/data/roganizo.db" },
  { key: "WEB_PASSWORD", group: "web" },
  { key: "TIMEZONE", group: "preferences", kind: "datalist", options: COMMON_TIMEZONES },
  { key: "BRIEFING_TIME", group: "preferences", kind: "time" },
  { key: "LANGUAGE", group: "preferences", kind: "select", options: ["es", "en"] },
];

export const FIELD_BY_KEY: Record<string, SettingsFieldDef | undefined> = Object.fromEntries(
  SETTINGS_FIELDS.map((f) => [f.key, f]),
);

export interface HelpLink {
  label: string;
  url: string;
}

export interface HelpStep {
  text: string;
  /** Monospace snippet under the step; `{publicUrl}` is interpolated at render time. */
  code?: string;
  links?: HelpLink[];
  /** Optional illustration. Ship v1 without any: no empty placeholder boxes. */
  image?: string;
}

export interface HelpDoc {
  steps: HelpStep[];
}

const HELP_ES: Partial<Record<SettingsGroupKey, HelpDoc>> = {
  telegram: {
    steps: [
      {
        text: "Abrí @BotFather en Telegram y mandale /newbot. Elegí un nombre y un usuario terminado en «bot»: te devuelve el token.",
        links: [{ label: "@BotFather", url: "https://t.me/BotFather" }],
      },
      {
        text: "Tocá «Vincular mi cuenta» y abrí el enlace: al iniciar el bot, Roganizo detecta tu ID automáticamente y sólo atiende a esa cuenta.",
      },
      {
        text: "CallMeBot es opcional y sirve para las llamadas de urgencia: mandale /start y activá las llamadas desde tu cuenta. Después poné acá tu usuario de Telegram con @. Si lo dejás vacío, no hay llamadas.",
        links: [{ label: "CallMeBot", url: "https://www.callmebot.com/blog/telegram-call-api/" }],
      },
    ],
  },
  model: {
    steps: [
      {
        text: "Elegí el proveedor. OpenAI usa tu cuenta de platform.openai.com directo; OpenRouter da acceso a cientos de modelos de otros proveedores con una sola key. Solo se muestran los campos del que elijas.",
      },
      {
        text: "OpenAI: entrá a platform.openai.com/api-keys, creá una key y copiala (se ve una sola vez). La cuenta necesita saldo cargado en Billing.",
        links: [
          { label: "API keys de OpenAI", url: "https://platform.openai.com/api-keys" },
          { label: "Billing", url: "https://platform.openai.com/settings/organization/billing" },
        ],
      },
      {
        text: "OpenAI: gpt-6-luna es el más rápido y barato, y alcanza para el día a día. Como refuerzo conviene gpt-6.1-sol. Si ponés gpt-6.1-sol o gpt-6-astra como modelo base, subí el razonamiento a low o más: no aceptan none.",
        code: "gpt-6-luna",
        links: [{ label: "Modelos de OpenAI", url: "https://developers.openai.com/api/docs/models" }],
      },
      {
        text: "OpenRouter: entrá a openrouter.ai/keys, creá una key nueva y copiala. Se ve una sola vez.",
        links: [{ label: "openrouter.ai/keys", url: "https://openrouter.ai/keys" }],
      },
      {
        text: "OpenRouter: elegí el modelo en el catálogo y pegá su identificador completo, con la barra incluida.",
        code: "deepseek/deepseek-v4-flash-0731",
        links: [{ label: "openrouter.ai/models", url: "https://openrouter.ai/models" }],
      },
      {
        text: "OpenRouter: el orden de providers es una lista separada por comas con los proveedores que preferís. Si ninguno responde, entra el criterio de fallback: price busca el más barato, throughput el más rápido y latency el que menos tarda en arrancar.",
        links: [{ label: "Routing de providers", url: "https://openrouter.ai/docs/features/provider-routing" }],
      },
    ],
  },
  google: {
    steps: [
      {
        text: "Creá un proyecto en Google Cloud Console (o elegí uno que ya tengas).",
        links: [{ label: "Nuevo proyecto", url: "https://console.cloud.google.com/projectcreate" }],
      },
      {
        text: "Activá las dos APIs que usa Roganizo: Google Calendar API y Google Tasks API.",
        links: [
          { label: "Calendar API", url: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
          { label: "Tasks API", url: "https://console.cloud.google.com/apis/library/tasks.googleapis.com" },
        ],
      },
      {
        text: "Configurá la pantalla de consentimiento: elegí audiencia Externa, poné un nombre para la app y tu email de soporte y contacto.",
        links: [{ label: "Pantalla de consentimiento", url: "https://console.cloud.google.com/apis/credentials/consent" }],
      },
      {
        text: "En Audiencia, tocá «Publicar app» para dejarla «En producción». En Testing, Google vence el acceso cada 7 días y el bot deja de funcionar a la semana.",
      },
      {
        text: "Creá un ID de cliente OAuth de tipo «Aplicación web» y agregá como URI de redireccionamiento exactamente la dirección que muestra Roganizo.",
        links: [{ label: "Credenciales", url: "https://console.cloud.google.com/apis/credentials" }],
      },
      { text: "Copiá el Client ID y el Client secret. En el primer ingreso, si Google dice que no verificó la app, elegí «Configuración avanzada» → «Ir a la app»: es tu propia aplicación." },
    ],
  },
};

const HELP_EN: Partial<Record<SettingsGroupKey, HelpDoc>> = {
  telegram: {
    steps: [
      {
        text: "Open @BotFather in Telegram and send /newbot. Pick a name and a username ending in “bot”: it hands you the token.",
        links: [{ label: "@BotFather", url: "https://t.me/BotFather" }],
      },
      {
        text: "Choose “Link my account” and open the link: when you start the bot, Roganizo detects your ID automatically and only answers that account.",
      },
      {
        text: "CallMeBot is optional and powers the urgent calls: send it /start and enable calls from your account. Then put your Telegram username here, with the @. Leave it empty and there are no calls.",
        links: [{ label: "CallMeBot", url: "https://www.callmebot.com/blog/telegram-call-api/" }],
      },
    ],
  },
  model: {
    steps: [
      {
        text: "Pick the provider. OpenAI uses your platform.openai.com account directly; OpenRouter gives you hundreds of models from other providers behind a single key. Only the fields of the one you pick are shown.",
      },
      {
        text: "OpenAI: go to platform.openai.com/api-keys, create a key and copy it (it is shown only once). The account needs credit loaded under Billing.",
        links: [
          { label: "OpenAI API keys", url: "https://platform.openai.com/api-keys" },
          { label: "Billing", url: "https://platform.openai.com/settings/organization/billing" },
        ],
      },
      {
        text: "OpenAI: gpt-6-luna is the fastest and cheapest, and enough for everyday use. gpt-6.1-sol makes a good backup model. If you set gpt-6.1-sol or gpt-6-astra as the base model, raise reasoning to low or above: they do not accept none.",
        code: "gpt-6-luna",
        links: [{ label: "OpenAI models", url: "https://developers.openai.com/api/docs/models" }],
      },
      {
        text: "OpenRouter: go to openrouter.ai/keys, create a new key and copy it. It is shown only once.",
        links: [{ label: "openrouter.ai/keys", url: "https://openrouter.ai/keys" }],
      },
      {
        text: "OpenRouter: pick the model from the catalogue and paste its full identifier, slash included.",
        code: "deepseek/deepseek-v4-flash-0731",
        links: [{ label: "openrouter.ai/models", url: "https://openrouter.ai/models" }],
      },
      {
        text: "OpenRouter: the provider order is a comma-separated list of the providers you prefer. If none of them answers, the fallback criterion kicks in: price goes for the cheapest, throughput for the fastest and latency for the quickest to start.",
        links: [{ label: "Provider routing", url: "https://openrouter.ai/docs/features/provider-routing" }],
      },
    ],
  },
  google: {
    steps: [
      {
        text: "Create a project in the Google Cloud Console (or pick one you already have).",
        links: [{ label: "New project", url: "https://console.cloud.google.com/projectcreate" }],
      },
      {
        text: "Enable the two APIs Roganizo uses: Google Calendar API and Google Tasks API.",
        links: [
          { label: "Calendar API", url: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
          { label: "Tasks API", url: "https://console.cloud.google.com/apis/library/tasks.googleapis.com" },
        ],
      },
      {
        text: "Configure the OAuth consent screen: choose External, then enter an app name and your support and contact email.",
        links: [{ label: "Consent screen", url: "https://console.cloud.google.com/apis/credentials/consent" }],
      },
      {
        text: "Under Audience, click “Publish app” so its status becomes “In production”. In Testing, Google expires access every 7 days and the bot stops working a week later.",
      },
      {
        text: "Create an OAuth client ID of type “Web application” and add exactly the redirect URI shown by Roganizo.",
        links: [{ label: "Credentials", url: "https://console.cloud.google.com/apis/credentials" }],
      },
      { text: "Copy the Client ID and Client secret. On the first sign-in, if Google says it has not verified the app, choose “Advanced” → “Go to the app”: it is your own application." },
    ],
  },
};

export function helpFor(group: SettingsGroupKey, lang: Lang): HelpDoc | undefined {
  return (lang === "es" ? HELP_ES : HELP_EN)[group];
}
