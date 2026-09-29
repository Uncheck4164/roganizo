import { config } from "../config.js";
import {
  isRetryableStatus,
  LlmError,
  normalizeToolCalls,
  withRetries,
  type ChatMessage,
  type ModelReply,
} from "./llm.js";

/**
 * Hardened OpenRouter client.
 *
 * The previous version was a bare `fetch`: no timeout (a stuck request hung the
 * whole Telegram turn forever), no retries, and it only looked at HTTP status —
 * but OpenRouter also reports failures as HTTP 200 with an `error` object in the
 * body when the provider dies mid-generation, which surfaced as the useless
 * "OpenRouter returned an empty response".
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;
/** Cap per reply. Tool-call arguments are small; long prose is not wanted here. */
const MAX_TOKENS = 4_000;

interface ApiError {
  code?: number | string;
  message?: string;
  metadata?: Record<string, unknown>;
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
 * Endpoints allowed at each quality floor. 4-bit quantizations are the cheapest
 * and by far the worst at multi-step tool calling, which is the only thing this
 * bot does — keeping them out is the whole point of the floor. "unknown" stays
 * allowed at every level: plenty of solid providers simply do not report a
 * quantization, and excluding them would leave good models with no endpoint.
 */
const QUANTIZATION_FLOORS: Record<string, string[]> = {
  any: [],
  "6bit": ["fp6", "fp8", "mxfp8", "int8", "fp16", "bf16", "fp32", "unknown"],
  "8bit": ["fp8", "mxfp8", "int8", "fp16", "bf16", "fp32", "unknown"],
  "16bit": ["fp16", "bf16", "fp32", "unknown"],
};

/** "1,3" → at most 1 USD per million prompt tokens and 3 per million output. */
function priceCeiling(): { prompt: number; completion: number } | undefined {
  if (!config.OPENROUTER_MAX_PRICE) return undefined;
  const [prompt, completion] = config.OPENROUTER_MAX_PRICE.split(",").map(Number);
  if (!Number.isFinite(prompt!) || !Number.isFinite(completion!)) return undefined;
  return { prompt: prompt!, completion: completion! };
}

/**
 * Routing preferences. `relaxed` drops the quality floor and the price ceiling:
 * that is the second chance taken when the filters leave OpenRouter with nothing
 * to route to, because a bot that answers nothing is worse than a cheap answer.
 */
function providerBlock(relaxed: boolean, model: string) {
  const order = config.OPENROUTER_PROVIDER_ORDER
    ? config.OPENROUTER_PROVIDER_ORDER.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const quantizations = relaxed ? [] : QUANTIZATION_FLOORS[config.OPENROUTER_QUALITY_FLOOR] ?? [];
  // The ceiling guards the everyday model against an expensive provider serving
  // it. It deliberately does not apply to the reinforcement model: that one is
  // only reached after a turn already failed, and costing more is its job — a
  // ceiling tight enough to be useful here would leave it with no endpoint.
  const ceiling = relaxed || model !== config.OPENROUTER_MODEL ? undefined : priceCeiling();
  return {
    ...(order.length ? { order } : {}),
    // No `sort` is not "no preference": it is OpenRouter's own balance — skip
    // providers with recent outages, then pick among the stable ones weighted by
    // inverse square of price. Pinning sort:"price" switches that balance off
    // and always takes the cheapest endpoint, however badly it is behaving.
    ...(config.OPENROUTER_SORT === "auto" ? {} : { sort: config.OPENROUTER_SORT }),
    ...(quantizations.length ? { quantizations } : {}),
    ...(ceiling ? { max_price: ceiling } : {}),
    allow_fallbacks: true,
    // Without this, a fallback provider that does not implement tool calling can
    // be picked: it answers prose and the bot silently stops doing anything.
    require_parameters: true,
  };
}

/** True when a relaxed retry would actually send something different. */
function hasRoutingFilters(model: string): boolean {
  return (
    (QUANTIZATION_FLOORS[config.OPENROUTER_QUALITY_FLOOR]?.length ?? 0) > 0 ||
    (model === config.OPENROUTER_MODEL && priceCeiling() !== undefined)
  );
}

/** One line describing where a request would be routed, for /diag. */
export function routingSummary(): string {
  const floor =
    config.OPENROUTER_QUALITY_FLOOR === "any" ? "quant=any" : `quant>=${config.OPENROUTER_QUALITY_FLOOR}`;
  const ceiling = config.OPENROUTER_MAX_PRICE
    ? `max_price=${config.OPENROUTER_MAX_PRICE} $/M (base)`
    : "max_price=off";
  return `sort=${config.OPENROUTER_SORT} · ${floor} · ${ceiling} · providers=${config.OPENROUTER_PROVIDER_ORDER || "auto"}`;
}

export async function singleCall(
  messages: ChatMessage[],
  tools: unknown,
  model: string,
  relaxed = false,
): Promise<ModelReply> {
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
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2, // scheduling is not a creative task
        max_tokens: MAX_TOKENS,
        provider: providerBlock(relaxed, model),
        usage: { include: true },
      }),
    });
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    throw new LlmError(
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
    throw new LlmError(
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
    throw new LlmError(
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
    throw new LlmError(
      `empty response: ${bodyText.slice(0, 200)}`,
      "El modelo devolvió una respuesta vacía.",
      true,
    );
  }

  const toolCalls = normalizeToolCalls(
    Array.isArray(raw.tool_calls)
      ? raw.tool_calls.map((c: { id?: string; function?: { name?: string; arguments?: unknown } }) => ({
          id: c?.id,
          name: c?.function?.name,
          arguments: c?.function?.arguments,
        }))
      : [],
  );
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

/** One model turn, with a relaxed second chance when the routing floor matches nothing. */
export async function callModel(messages: ChatMessage[], tools: unknown, model: string): Promise<ModelReply> {
  try {
    return await withRetries(model, () => singleCall(messages, tools, model, false));
  } catch (err) {
    // The quality floor (or the price ceiling) matched no endpoint at all.
    // Answering from a cheaper one beats not answering, but the log has to say
    // it, because it means the floor and the model do not fit each other.
    if (err instanceof LlmError && err.noEndpoints && hasRoutingFilters(model)) {
      console.warn(`[llm] no endpoint matches the routing floor (${err.message}); retrying without it`);
      return withRetries(model, () => singleCall(messages, tools, model, true));
    }
    throw err;
  }
}
