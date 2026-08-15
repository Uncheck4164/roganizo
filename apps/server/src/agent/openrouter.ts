import { config } from "../config.js";

/**
 * Hardened OpenRouter client.
 *
 * The previous version was a bare `fetch`: no timeout (a stuck request hung the
 * whole Telegram turn forever), no retries, and it only looked at HTTP status —
 * but OpenRouter also reports failures as HTTP 200 with an `error` object in the
 * body when the provider dies mid-generation, which surfaced as the useless
 * "OpenRouter returned an empty response".
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ModelReply {
  message: ChatMessage;
  finishReason: string | null;
  /** Provider that actually served the request (OpenRouter routes per call). */
  provider?: string;
  usage?: { prompt: number; completion: number; cost?: number };
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 20_000;
/** Cap per reply. Tool-call arguments are small; long prose is not wanted here. */
const MAX_TOKENS = 4_000;

/** Failure with a message meant for the user, not a raw stack trace. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly userHint: string,
    readonly retryable: boolean,
    readonly status?: number,
    /** Seconds requested by the server through the Retry-After header. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

interface ApiError {
  code?: number | string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/** Status codes worth trying again: transient by definition. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function hintFor(status: number | undefined, message: string): string {
  switch (status) {
    case 401:
      return "La API key de OpenRouter no es válida o fue revocada. Revisala en la configuración web.";
    case 402:
      return "Tu cuenta de OpenRouter se quedó sin créditos.";
    case 403:
      return "OpenRouter rechazó el pedido (moderación o permisos del modelo).";
    case 404:
      return `El modelo "${config.OPENROUTER_MODEL}" no existe o ya no está disponible. Cambialo en la configuración web.`;
    case 429:
      return "OpenRouter está limitando los pedidos (rate limit). Probá de nuevo en un minuto.";
    case 408:
      return "El modelo tardó demasiado en responder.";
    default:
      if (status && status >= 500) return "OpenRouter o el proveedor del modelo están caídos ahora mismo.";
      return message;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number, retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return exponential + Math.random() * 250; // jitter
}

/** Some providers return content as an array of parts instead of a string. */
function normalizeContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

/**
 * Drops tool calls the loop could not execute anyway (missing name, duplicated
 * id). A malformed call left in the history breaks every later request, because
 * the API demands one tool result per tool call.
 */
function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const seen = new Set<string>();
  const calls: ToolCall[] = [];
  for (const [i, item] of raw.entries()) {
    const call = item as Partial<ToolCall> & { function?: { name?: string; arguments?: unknown } };
    const name = call.function?.name;
    if (!name) continue;
    const id = call.id && !seen.has(call.id) ? call.id : `call_${i}_${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    calls.push({
      id,
      type: "function",
      function: {
        name,
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
      },
    });
  }
  return calls.length ? calls : undefined;
}

function providerBlock() {
  const order = config.OPENROUTER_PROVIDER_ORDER
    ? config.OPENROUTER_PROVIDER_ORDER.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    ...(order.length ? { order } : {}),
    sort: config.OPENROUTER_SORT,
    allow_fallbacks: true,
    // Without this, a fallback provider that does not implement tool calling can
    // be picked: it answers prose and the bot silently stops doing anything.
    require_parameters: true,
  };
}

async function singleCall(messages: ChatMessage[], tools: unknown): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.PUBLIC_URL,
        "X-Title": "Roganizo",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2, // scheduling is not a creative task
        max_tokens: MAX_TOKENS,
        provider: providerBlock(),
        usage: { include: true },
      }),
    });
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    throw new OpenRouterError(
      aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `network error: ${(err as Error).message}`,
      aborted
        ? "El modelo no respondió a tiempo."
        : "No pude conectarme a OpenRouter (problema de red).",
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
  const bodyText = await res.text();
  let body: {
    choices?: { message?: Record<string, unknown>; finish_reason?: string }[];
    error?: ApiError;
    provider?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    throw new OpenRouterError(
      `non-JSON response (${res.status}): ${bodyText.slice(0, 200)}`,
      "OpenRouter devolvió una respuesta que no entiendo.",
      isRetryableStatus(res.status),
      res.status,
      retryAfter,
    );
  }

  // An `error` object can arrive with HTTP 200 when generation fails halfway.
  const apiError = body.error;
  if (!res.ok || apiError) {
    const status = res.ok ? Number(apiError?.code) || res.status : res.status;
    const message = apiError?.message ?? bodyText.slice(0, 300);
    throw new OpenRouterError(
      `OpenRouter ${status}: ${message}`,
      hintFor(status, message),
      isRetryableStatus(status),
      status,
      retryAfter,
    );
  }

  const choice = body.choices?.[0];
  const raw = choice?.message;
  if (!raw) {
    throw new OpenRouterError(
      `empty response: ${bodyText.slice(0, 200)}`,
      "El modelo devolvió una respuesta vacía.",
      true,
    );
  }

  const toolCalls = normalizeToolCalls(raw.tool_calls);
  return {
    message: {
      role: "assistant",
      content: normalizeContent(raw.content),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    },
    finishReason: choice?.finish_reason ?? null,
    provider: body.provider,
    usage: body.usage
      ? {
          prompt: body.usage.prompt_tokens ?? 0,
          completion: body.usage.completion_tokens ?? 0,
          cost: body.usage.cost,
        }
      : undefined,
  };
}

/** One model turn, retried on transient failures. */
export async function callModel(messages: ChatMessage[], tools: unknown): Promise<ModelReply> {
  let last: OpenRouterError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const started = Date.now();
      const reply = await singleCall(messages, tools);
      const { usage } = reply;
      console.log(
        `[llm] ${config.OPENROUTER_MODEL} via ${reply.provider ?? "?"} in ${Date.now() - started}ms` +
          (usage ? ` — ${usage.prompt}+${usage.completion} tok` : "") +
          (usage?.cost !== undefined ? ` — $${usage.cost.toFixed(6)}` : "") +
          ` — finish=${reply.finishReason ?? "?"}`,
      );
      return reply;
    } catch (err) {
      if (!(err instanceof OpenRouterError) || !err.retryable) throw err;
      last = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = backoffMs(attempt, err.retryAfter);
        console.warn(`[llm] attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (${err.message}); retrying in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
  }
  throw last ?? new OpenRouterError("unknown failure", "Fallo desconocido llamando al modelo.", false);
}

export interface DiagnosticsResult {
  ok: boolean;
  model: string;
  provider?: string;
  latencyMs: number;
  cost?: number;
  error?: string;
}

/** Minimal round trip used by /diag: proves key, model and routing all work. */
export async function checkModel(): Promise<DiagnosticsResult> {
  const started = Date.now();
  try {
    const reply = await singleCall([{ role: "user", content: "ping" }], undefined);
    return {
      ok: true,
      model: config.OPENROUTER_MODEL,
      provider: reply.provider,
      latencyMs: Date.now() - started,
      cost: reply.usage?.cost,
    };
  } catch (err) {
    return {
      ok: false,
      model: config.OPENROUTER_MODEL,
      latencyMs: Date.now() - started,
      error: err instanceof OpenRouterError ? err.userHint : (err as Error).message,
    };
  }
}
