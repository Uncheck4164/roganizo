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
}

export interface SettingsPayload {
  setupRequired: boolean;
  values: Record<string, string>;
  meta: Record<string, SettingsFieldMeta>;
}

export interface SetupStatus {
  setupRequired: boolean;
  passwordSet: boolean;
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
  { key: "OPENROUTER_API_KEY", group: "model" },
  { key: "OPENROUTER_MODEL", group: "model" },
  { key: "OPENROUTER_PROVIDER_ORDER", group: "model", placeholder: "deepinfra,baidu" },
  { key: "OPENROUTER_SORT", group: "model", kind: "select", options: ["price", "throughput", "latency"] },
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
        text: "Escribile a @userinfobot y te contesta con tu ID numérico. Ese es el único usuario que el bot va a atender.",
        links: [{ label: "@userinfobot", url: "https://t.me/userinfobot" }],
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
        text: "Entrá a openrouter.ai/keys, creá una key nueva y copiala. Se ve una sola vez.",
        links: [{ label: "openrouter.ai/keys", url: "https://openrouter.ai/keys" }],
      },
      {
        text: "Elegí el modelo en el catálogo y pegá su identificador completo, con la barra incluida.",
        code: "deepseek/deepseek-chat",
        links: [{ label: "openrouter.ai/models", url: "https://openrouter.ai/models" }],
      },
      {
        text: "El orden de providers es una lista separada por comas con los proveedores que preferís. Si ninguno responde, entra el criterio de fallback: price busca el más barato, throughput el más rápido y latency el que menos tarda en arrancar.",
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
        text: "En Credenciales elegí «Crear credenciales» → «ID de cliente de OAuth» y como tipo de aplicación poné «Aplicación web».",
        links: [{ label: "Credenciales", url: "https://console.cloud.google.com/apis/credentials" }],
      },
      {
        text: "En «URI de redireccionamiento autorizados» agregá exactamente esta dirección:",
        code: "{publicUrl}/oauth/callback",
      },
      {
        text: "En la pantalla de consentimiento de OAuth, agregate a vos mismo como usuario de prueba con tu cuenta de Google. Si no, el login te va a rechazar.",
        links: [{ label: "Pantalla de consentimiento", url: "https://console.cloud.google.com/apis/credentials/consent" }],
      },
      { text: "Copiá el Client ID y el Client secret que quedaron creados y pegalos acá arriba." },
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
        text: "Message @userinfobot and it replies with your numeric ID. That is the only user the bot will answer.",
        links: [{ label: "@userinfobot", url: "https://t.me/userinfobot" }],
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
        text: "Go to openrouter.ai/keys, create a new key and copy it. It is shown only once.",
        links: [{ label: "openrouter.ai/keys", url: "https://openrouter.ai/keys" }],
      },
      {
        text: "Pick the model from the catalogue and paste its full identifier, slash included.",
        code: "deepseek/deepseek-chat",
        links: [{ label: "openrouter.ai/models", url: "https://openrouter.ai/models" }],
      },
      {
        text: "The provider order is a comma-separated list of the providers you prefer. If none of them answers, the fallback criterion kicks in: price goes for the cheapest, throughput for the fastest and latency for the quickest to start.",
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
        text: "Under Credentials pick “Create credentials” → “OAuth client ID” and choose “Web application” as the application type.",
        links: [{ label: "Credentials", url: "https://console.cloud.google.com/apis/credentials" }],
      },
      {
        text: "In “Authorised redirect URIs” add exactly this address:",
        code: "{publicUrl}/oauth/callback",
      },
      {
        text: "On the OAuth consent screen, add yourself as a test user with your Google account. Otherwise the login will reject you.",
        links: [{ label: "Consent screen", url: "https://console.cloud.google.com/apis/credentials/consent" }],
      },
      { text: "Copy the Client ID and the Client secret that were created and paste them above." },
    ],
  },
};

export function helpFor(group: SettingsGroupKey, lang: Lang): HelpDoc | undefined {
  return (lang === "es" ? HELP_ES : HELP_EN)[group];
}
