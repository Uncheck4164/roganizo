import { desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { t } from "../i18n.js";
import { systemPrompt } from "./prompt.js";
import { executeTool, toolDefinitions, type PendingRequest, type ToolContext } from "./tools/index.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

const MAX_ITERATIONS = 10;
/** Full conversation turns that get replayed to the model. */
const HISTORY_TURNS = 8;
/** Raw rows read to rebuild those turns (each turn spans several rows). */
const HISTORY_ROWS = 120;
/** Tool results are truncated when persisted (the live turn uses the full one). */
const TOOL_RESULT_MAX = 1200;

/**
 * Phrases the model uses to claim it did something. No \b on purpose: in JS it
 * is ASCII-only and breaks with accents ("sumé") and emojis ("Listo ✅").
 */
const CLAIMS_ACTION =
  /(^|[^a-záéíóúñ])(cre[eéa]|agend[eéa]|program[eéa]|guard[eéa]|actualic|actualizad|modifiqu|elimin|borr[eéaó]|mov[ií]|extend[ií]|sum[eéo]|añad|qued[oó]|corregid|corrig[ií]|(list|hech)[oa]\s*✅)/i;

async function callOpenRouter(messages: ChatMessage[]) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Roganizo",
    },
    body: JSON.stringify({
      model: config.OPENROUTER_MODEL,
      messages,
      tools: toolDefinitions,
      provider: {
        ...(config.OPENROUTER_PROVIDER_ORDER
          ? { order: config.OPENROUTER_PROVIDER_ORDER.split(",").map((s) => s.trim()) }
          : {}),
        sort: config.OPENROUTER_SORT,
        allow_fallbacks: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices: { message: ChatMessage }[];
  };
  const msg = data.choices[0]?.message;
  if (!msg) throw new Error("OpenRouter returned an empty response");
  return msg;
}

/**
 * Keeps only sequences the API accepts: starts at a user message and cuts
 * before any tool_call left without its result (which happens when the process
 * died mid-turn).
 */
function sanitize(msgs: ChatMessage[]): ChatMessage[] {
  const start = msgs.findIndex((m) => m.role === "user");
  if (start === -1) return [];
  const src = msgs.slice(start);
  const out: ChatMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i]!;
    if (m.role === "assistant" && m.tool_calls?.length) {
      const answered = new Set(
        src
          .slice(i + 1)
          .filter((x) => x.role === "tool")
          .map((x) => x.tool_call_id),
      );
      if (!m.tool_calls.every((c) => answered.has(c.id))) break;
    }
    out.push(m);
  }
  return out;
}

function loadHistory(): ChatMessage[] {
  const rows = db
    .select()
    .from(schema.chatHistory)
    .orderBy(desc(schema.chatHistory.id))
    .limit(HISTORY_ROWS)
    .all()
    .reverse();

  // Old rows (without payload) are exactly the ones that taught the model to
  // lie: they stored the success text without the tool call backing it.
  const msgs = rows
    .filter((r) => r.payload)
    .map((r) => JSON.parse(r.payload!) as ChatMessage);

  // Group into turns (each turn starts with a user message)
  const turns: ChatMessage[][] = [];
  for (const m of msgs) {
    if (m.role === "user" || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1]!.push(m);
  }
  return sanitize(turns.slice(-HISTORY_TURNS).flat());
}

function saveMessage(msg: ChatMessage) {
  const payload: ChatMessage =
    msg.role === "tool" && typeof msg.content === "string"
      ? { ...msg, content: msg.content.slice(0, TOOL_RESULT_MAX) }
      : msg;
  db.insert(schema.chatHistory)
    .values({
      role: msg.role,
      content: typeof payload.content === "string" ? payload.content : "",
      createdAt: new Date().toISOString(),
      payload: JSON.stringify(payload),
    })
    .run();
}

export function resetHistory() {
  db.delete(schema.chatHistory).run();
}

export interface AgentResult {
  text: string;
  pending: PendingRequest[];
}

/** Runs the tool-calling loop for one user message. */
export async function runAgent(userMessage: string): Promise<AgentResult> {
  const ctx: ToolContext = { pending: [], mutated: [] };
  const userMsg: ChatMessage = { role: "user", content: userMessage };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...loadHistory(),
    userMsg,
  ];

  saveMessage(userMsg);
  let corrected = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const msg = await callOpenRouter(messages);
    messages.push(msg);
    saveMessage(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = msg.content?.trim() || t("agentDone");

      // Safety net: if it claims it did something without having run any mutating
      // tool, demand that it actually does it (only once).
      if (!corrected && ctx.mutated!.length === 0 && CLAIMS_ACTION.test(text)) {
        corrected = true;
        console.warn(`[agent] reply with no real action, demanding a correction: "${text.slice(0, 80)}"`);
        messages.push({
          role: "system",
          content:
            "ALTO: no ejecutaste ninguna herramienta en este turno, así que NADA de lo que afirmaste ocurrió. " +
            "Si el usuario pidió crear/modificar/borrar algo, llamá AHORA a la herramienta correspondiente. " +
            "Si no correspondía ninguna acción, respondé de nuevo sin afirmar que hiciste algo.",
        });
        continue;
      }

      return { text, pending: ctx.pending };
    }

    for (const call of msg.tool_calls) {
      let result: unknown;
      try {
        const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        result = await executeTool(call.function.name, args, ctx);
      } catch (err) {
        result = { error: (err as Error).message };
      }
      const serialized = JSON.stringify(result);
      console.log(`[tool] ${call.function.name}(${call.function.arguments}) -> ${serialized.slice(0, 200)}`);
      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: call.id,
        content: serialized,
      };
      messages.push(toolMsg);
      saveMessage(toolMsg);
    }
  }

  const text = t("agentTooManySteps");
  saveMessage({ role: "assistant", content: text });
  return { text, pending: ctx.pending };
}

/** Runs the actions of a confirmed pending_action. Returns a summary per action. */
export async function executePendingAction(pendingId: number): Promise<string[]> {
  const { eq } = await import("drizzle-orm");
  const row = db
    .select()
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.id, pendingId))
    .get();
  if (!row || row.status !== "pending") return [t("pendingGone")];

  // Consume BEFORE running: if the process dies halfway through, a redelivered
  // callback must not re-run everything (it would duplicate events).
  db.update(schema.pendingActions)
    .set({ status: "confirmed" })
    .where(eq(schema.pendingActions.id, pendingId))
    .run();

  const actions = JSON.parse(row.actionsJson) as { tool: string; args: Record<string, unknown> }[];
  const ctx: ToolContext = { confirmed: true, pending: [] };
  const lines: string[] = [];
  for (const a of actions) {
    try {
      const result = (await executeTool(a.tool, a.args, ctx)) as Record<string, unknown>;
      if (result && result.conflict) {
        lines.push(t("batchConflict", { label: String(a.args.title ?? a.tool) }));
      } else {
        lines.push(`✅ ${a.args.title ?? a.args.message ?? a.tool}`);
      }
    } catch (err) {
      lines.push(`❌ ${a.args.title ?? a.tool}: ${(err as Error).message}`);
    }
  }
  return lines;
}

export async function cancelPendingAction(pendingId: number): Promise<void> {
  const { eq } = await import("drizzle-orm");
  db.update(schema.pendingActions)
    .set({ status: "cancelled" })
    .where(eq(schema.pendingActions.id, pendingId))
    .run();
}
