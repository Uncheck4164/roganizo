import { desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
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
const HISTORY_LIMIT = 20;

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
  if (!msg) throw new Error("OpenRouter devolvió una respuesta vacía");
  return msg;
}

function loadHistory(): ChatMessage[] {
  const rows = db
    .select()
    .from(schema.chatHistory)
    .orderBy(desc(schema.chatHistory.id))
    .limit(HISTORY_LIMIT)
    .all()
    .reverse();
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

function saveHistory(role: "user" | "assistant", content: string) {
  db.insert(schema.chatHistory)
    .values({ role, content, createdAt: new Date().toISOString() })
    .run();
}

export function resetHistory() {
  db.delete(schema.chatHistory).run();
}

export interface AgentResult {
  text: string;
  pending: PendingRequest[];
}

/** Corre el loop de tool-calling para un mensaje del usuario. */
export async function runAgent(userMessage: string): Promise<AgentResult> {
  const ctx: ToolContext = { pending: [] };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...loadHistory(),
    { role: "user", content: userMessage },
  ];

  saveHistory("user", userMessage);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const msg = await callOpenRouter(messages);
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = msg.content?.trim() || "Listo.";
      saveHistory("assistant", text);
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
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  const text =
    "Me quedé sin pasos para completar eso (demasiadas operaciones seguidas). Probá dividir el pedido.";
  saveHistory("assistant", text);
  return { text, pending: ctx.pending };
}

/** Ejecuta las acciones de un pending_action confirmado. Devuelve resumen por acción. */
export async function executePendingAction(pendingId: number): Promise<string[]> {
  const { eq } = await import("drizzle-orm");
  const row = db
    .select()
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.id, pendingId))
    .get();
  if (!row || row.status !== "pending") return ["Esta acción ya no está pendiente."];

  // Consumir ANTES de ejecutar: si el proceso muere a mitad de camino, la
  // re-entrega del callback no debe re-ejecutar todo (duplicaría eventos).
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
        lines.push(`⚠️ ${a.args.title ?? a.tool}: no se creó, hay conflicto de horario.`);
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
