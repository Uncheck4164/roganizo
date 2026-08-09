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
/** Turnos completos de conversación que se le reinyectan al modelo. */
const HISTORY_TURNS = 8;
/** Filas crudas a leer para armar esos turnos (cada turno son varias filas). */
const HISTORY_ROWS = 120;
/** Resultados de tools recortados al persistirlos (el turno vivo usa el completo). */
const TOOL_RESULT_MAX = 1200;

/**
 * Frases con las que el modelo afirma haber hecho algo. Sin \b a propósito:
 * en JS es ASCII-only y se rompe con acentos ("sumé") y emojis ("Listo ✅").
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
  if (!msg) throw new Error("OpenRouter devolvió una respuesta vacía");
  return msg;
}

/**
 * Deja solo secuencias válidas para la API: arranca en un mensaje de usuario y
 * corta antes de cualquier tool_call que se haya quedado sin su resultado
 * (pasa si el proceso murió a mitad de un turno).
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

  // Las filas viejas (sin payload) son justamente las que enseñaban a mentir:
  // guardaban el texto de éxito sin la llamada a la tool que lo respaldaba.
  const msgs = rows
    .filter((r) => r.payload)
    .map((r) => JSON.parse(r.payload!) as ChatMessage);

  // Agrupar en turnos (cada turno arranca en un mensaje del usuario)
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

/** Corre el loop de tool-calling para un mensaje del usuario. */
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
      const text = msg.content?.trim() || "Listo.";

      // Red de seguridad: si afirma haber hecho algo sin haber ejecutado
      // ninguna tool mutante, se le exige que lo haga de verdad (una sola vez).
      if (!corrected && ctx.mutated!.length === 0 && CLAIMS_ACTION.test(text)) {
        corrected = true;
        console.warn(`[agente] respuesta sin acción real, exigiendo corrección: "${text.slice(0, 80)}"`);
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

  const text =
    "Me quedé sin pasos para completar eso (demasiadas operaciones seguidas). Probá dividir el pedido.";
  saveMessage({ role: "assistant", content: text });
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
