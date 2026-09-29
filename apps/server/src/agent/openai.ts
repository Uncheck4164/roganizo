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
 * OpenAI client on the Responses API. Chat Completions would have been the
 * one-line swap, but from GPT-5.4 on it only takes tools with reasoning effort
 * "none", and GPT-6.1 Sol / GPT-6 Astra (the obvious reinforcement models) do
 * not support "none" at all — they call tools through Responses only.
 *
 * Requests are stateless (`store: false`): the agent already keeps its own
 * history, so each turn is replayed from it, translated to Responses items.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 90_000;
/** Cap per reply, reasoning included. Tool-call arguments are small. */
const MAX_OUTPUT_TOKENS = 4_000;
/**
 * Effort for the reinforcement model. "low" is the lowest value every current
 * model accepts; OPENAI_REASONING_EFFORT only drives the everyday one.
 */
const STRONG_REASONING_EFFORT = "low";

interface ApiError {
  code?: string | null;
  message?: string;
  type?: string;
}

interface OutputItem {
  type: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

function hintFor(status: number | undefined, message: string, model: string): string {
  switch (status) {
    case 401:
      return "La API key de OpenAI no es válida o fue revocada. Revisala en la configuración web.";
    case 403:
      return "OpenAI rechazó el pedido (permisos del proyecto o del modelo).";
    case 404:
      return `El modelo "${model}" no existe o tu cuenta no tiene acceso. Cambialo en la configuración web.`;
    case 429:
      return /quota|billing/i.test(message)
        ? "Tu cuenta de OpenAI se quedó sin saldo o llegó al límite de gasto."
        : "OpenAI está limitando los pedidos (rate limit). Probá de nuevo en un minuto.";
    case 408:
      return "El modelo tardó demasiado en responder.";
    default:
      if (status && status >= 500) return "OpenAI está caído ahora mismo.";
      return message;
  }
}

/**
 * Chat Completions history → Responses input items. System prompts go to
 * `instructions`; each tool call and each tool result becomes its own item,
 * linked by `call_id`.
 */
function toInput(messages: ChatMessage[]): { instructions?: string; input: unknown[] } {
  const system: string[] = [];
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) system.push(m.content);
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content ?? "" });
    } else {
      if (m.content) input.push({ role: m.role, content: m.content });
      for (const call of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }
  }
  return { ...(system.length ? { instructions: system.join("\n\n") } : {}), input };
}

/** Chat Completions tool definitions → Responses ones (flat, no `function` wrapper). */
function toTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool: { function?: Record<string, unknown> }) =>
    tool.function ? { type: "function", ...tool.function } : tool,
  );
}

export async function singleCall(messages: ChatMessage[], tools: unknown, model: string): Promise<ModelReply> {
  const effort = model === config.OPENAI_MODEL ? config.OPENAI_REASONING_EFFORT : STRONG_REASONING_EFFORT;
  const responseTools = toTools(tools);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...toInput(messages),
        ...(responseTools ? { tools: responseTools, tool_choice: "auto" } : {}),
        reasoning: { effort },
        // Sampling parameters are rejected unless reasoning is off.
        ...(effort === "none" ? { temperature: 0.2 } : {}), // scheduling is not a creative task
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
    });
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    throw new LlmError(
      aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `network error: ${(err as Error).message}`,
      aborted ? "El modelo no respondió a tiempo." : "No pude conectarme a OpenAI (problema de red).",
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
  const bodyText = await res.text();
  let body: {
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: OutputItem[];
    error?: ApiError | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    throw new LlmError(
      `non-JSON response (${res.status}): ${bodyText.slice(0, 200)}`,
      "OpenAI devolvió una respuesta que no entiendo.",
      isRetryableStatus(res.status),
      res.status,
      retryAfter,
    );
  }

  if (!res.ok || body.error || body.status === "failed") {
    // A response that failed while generating comes back with HTTP 200.
    const status = res.ok ? 500 : res.status;
    const message = body.error?.message ?? bodyText.slice(0, 300);
    // Out of credits is a 429 too, but waiting will not fix it.
    const retryable = isRetryableStatus(status) && body.error?.code !== "insufficient_quota";
    throw new LlmError(`OpenAI ${status}: ${message}`, hintFor(status, message, model), retryable, status, retryAfter);
  }

  const output = body.output ?? [];
  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  const toolCalls = normalizeToolCalls(
    output
      .filter((item) => item.type === "function_call")
      .map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments })),
  );
  if (!text && !toolCalls) {
    throw new LlmError(
      `empty response (status=${body.status ?? "?"}): ${bodyText.slice(0, 200)}`,
      "El modelo devolvió una respuesta vacía.",
      true,
    );
  }

  // Mapped to the Chat Completions vocabulary the agent logs and reasons about.
  const finishReason =
    body.status === "incomplete"
      ? body.incomplete_details?.reason === "max_output_tokens"
        ? "length"
        : body.incomplete_details?.reason ?? "incomplete"
      : toolCalls
        ? "tool_calls"
        : "stop";

  return {
    message: {
      role: "assistant",
      content: text || null,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    },
    finishReason,
    provider: "openai",
    usage: body.usage
      ? { prompt: body.usage.input_tokens ?? 0, completion: body.usage.output_tokens ?? 0 }
      : undefined,
  };
}

export function callModel(messages: ChatMessage[], tools: unknown, model: string): Promise<ModelReply> {
  return withRetries(model, () => singleCall(messages, tools, model));
}

/** One line describing how requests are sent, for /diag. */
export function routingSummary(): string {
  return `openai · reasoning=${config.OPENAI_REASONING_EFFORT} (base), ${STRONG_REASONING_EFFORT} (refuerzo)`;
}
