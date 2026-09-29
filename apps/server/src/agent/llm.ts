import { config } from "../config.js";
import * as openai from "./openai.js";
import * as openrouter from "./openrouter.js";

/**
 * Provider-agnostic model layer. The agent speaks the Chat Completions message
 * shape (it is what the history table stores); each provider module translates
 * to and from its own wire format and owns its failure hints.
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

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 20_000;

/** Failure with a message meant for the user, not a raw stack trace. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly userHint: string,
    readonly retryable: boolean,
    readonly status?: number,
    /** Seconds requested by the server through the Retry-After header. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  /** The routing filters left OpenRouter with no endpoint to send this to. */
  get noEndpoints(): boolean {
    return this.status === 404 || /no (?:allowed )?(?:endpoints?|providers?)/i.test(this.message);
  }
}

/** Status codes worth trying again: transient by definition. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number, retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return exponential + Math.random() * 250; // jitter
}

/**
 * Drops tool calls the loop could not execute anyway (missing name, duplicated
 * id). A malformed call left in the history breaks every later request, because
 * the API demands one tool result per tool call.
 */
export function normalizeToolCalls(
  raw: { id?: string; name?: string; arguments?: unknown }[],
): ToolCall[] | undefined {
  if (raw.length === 0) return undefined;
  const seen = new Set<string>();
  const calls: ToolCall[] = [];
  for (const [i, call] of raw.entries()) {
    const name = call.name;
    if (!name) continue;
    const id = call.id && !seen.has(call.id) ? call.id : `call_${i}_${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    calls.push({
      id,
      type: "function",
      function: {
        name,
        arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
      },
    });
  }
  return calls.length ? calls : undefined;
}

/** Transient failures only: the caller decides about the routing ones. */
export async function withRetries(model: string, call: () => Promise<ModelReply>): Promise<ModelReply> {
  let last: LlmError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const started = Date.now();
      const reply = await call();
      const { usage } = reply;
      console.log(
        `[llm] ${model} via ${reply.provider ?? "?"} in ${Date.now() - started}ms` +
          (usage ? ` — ${usage.prompt}+${usage.completion} tok` : "") +
          (usage?.cost !== undefined ? ` — $${usage.cost.toFixed(6)}` : "") +
          ` — finish=${reply.finishReason ?? "?"}`,
      );
      return reply;
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable) throw err;
      last = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = backoffMs(attempt, err.retryAfter);
        console.warn(`[llm] attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (${err.message}); retrying in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
  }
  throw last ?? new LlmError("unknown failure", "Fallo desconocido llamando al modelo.", false);
}

const provider = () => (config.LLM_PROVIDER === "openai" ? openai : openrouter);

/** Human name of the active provider, for /diag. */
export function providerName(): string {
  return config.LLM_PROVIDER === "openai" ? "OpenAI" : "OpenRouter";
}

/** The everyday model of the active provider. */
export function baseModel(): string {
  return config.LLM_PROVIDER === "openai" ? config.OPENAI_MODEL : config.OPENROUTER_MODEL;
}

/** Reinforcement model of the active provider; empty = never escalate. */
export function strongModel(): string {
  return config.LLM_PROVIDER === "openai" ? config.OPENAI_MODEL_STRONG : config.OPENROUTER_MODEL_STRONG;
}

/**
 * One model turn. `model` defaults to the cheap one; the agent passes the
 * reinforcement model once a turn has shown the cheap one cannot handle it.
 */
export function callModel(messages: ChatMessage[], tools: unknown, model: string = baseModel()): Promise<ModelReply> {
  return provider().callModel(messages, tools, model);
}

/** One line describing where a request would be routed, for /diag. */
export function routingSummary(): string {
  return provider().routingSummary();
}

export interface DiagnosticsResult {
  ok: boolean;
  model: string;
  provider?: string;
  latencyMs: number;
  cost?: number;
  error?: string;
}

/**
 * One throwaway tool. Sending it makes the check fail the way a real turn
 * would on a model or endpoint that cannot call tools, which is all this bot does.
 */
const PROBE_TOOLS = [
  {
    type: "function",
    function: {
      name: "ping",
      description: "Connectivity probe. Never needs to be called.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/** Minimal round trip used by /diag and setup: proves key, model, routing and tool support. */
export async function checkModel(model: string = baseModel()): Promise<DiagnosticsResult> {
  const started = Date.now();
  try {
    const reply = await provider().singleCall([{ role: "user", content: "Reply with: ok" }], PROBE_TOOLS, model);
    return {
      ok: true,
      model,
      provider: reply.provider,
      latencyMs: Date.now() - started,
      cost: reply.usage?.cost,
    };
  } catch (err) {
    return {
      ok: false,
      model,
      latencyMs: Date.now() - started,
      error: err instanceof LlmError ? err.userHint : (err as Error).message,
    };
  }
}
