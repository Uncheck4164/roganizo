import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { t } from "../i18n.js";
import { systemPrompt } from "./prompt.js";
import { callModel, OpenRouterError, type ChatMessage } from "./openrouter.js";
import {
  describeAction,
  hasErrors,
  issuesForModel,
  renderPlan,
  renderResults,
  sortPlan,
  validatePlan,
  type ActionResult,
  type PlanAction,
  type PlanIssue,
} from "./plan.js";
import { executeTool, toolDefinitions, type PendingRequest, type ToolContext } from "./tools/index.js";

const MAX_ITERATIONS = 10;
/** Full conversation turns that get replayed to the model. */
const HISTORY_TURNS = 8;
/** Raw rows read to rebuild those turns (each turn spans several rows). */
const HISTORY_ROWS = 120;
/** Tool results are truncated when persisted (the live turn uses the full one). */
const TOOL_RESULT_MAX = 1200;
/** How many times the model gets its own plan back to fix it before giving up. */
const MAX_PLAN_REVISIONS = 2;

/**
 * Phrases the model uses to claim it did something. No \b on purpose: in JS it
 * is ASCII-only and breaks with accents ("sumé") and emojis ("Listo ✅").
 */
const CLAIMS_ACTION =
  /(^|[^a-záéíóúñ])(cre[eéa]|agend[eéa]|program[eéa]|guard[eéa]|actualic|actualizad|modifiqu|elimin|borr[eéaó]|mov[ií]|extend[ií]|sum[eéo]|añad|qued[oó]|corregid|corrig[ií]|(list|hech)[oa]\s*✅)/i;

/**
 * Phrases where the model announces work instead of doing it ("déjame revisar
 * tu calendario"). It used to end the turn right there, which is exactly the
 * "it says it will think and then doesn't" complaint.
 *
 * The investigation verb is mandatory: without it, "voy a necesitar que me
 * digas la hora" — a legitimate question — would be pushed into calling tools.
 */
/**
 * Completion claims, in the narrow sense: first person past tense and "listo ✅".
 * Deliberately does NOT match infinitives ("te propongo crear..."), which are
 * the correct way to describe a plan that is still waiting for confirmation.
 */
export const CLAIMS_DONE =
  /(^|[^a-záéíóúñ])((list|hech)[oa]\s*[✅👍]|ya (?:est[áa] (?:list|agendad|cread|guardad)|qued[óo]|lo (?:hice|cre[eé]|agend[eé]|borr[eé]|mov[íi]))|(?:cre[eé]|agend[eé]|program[eé]|guard[eé]|actualic[eé]|modifiqu[eé]|elimin[eé]|borr[eé]|mov[íi]|a[ñn]ad[íi])[^a-záéíóúñ]|qued[óo] (?:agendad|cread|guardad|list)|(?:i )?(?:created|scheduled|deleted|updated|moved) )/i;

export const PROMISES_ACTION =
  /(d[eé]jame|d[eé]me|dame un|permíteme|voy a|ir[eé]|ahora(?: mismo)?|enseguida|en un momento|un segundo|primero|let me|i'?ll|i am going to|i'm going to)\b[^.!?\n]{0,40}?\b(revis|verific|busc|mir|consult|chequ|analiz|fij|comprob|ech[ao] un|check|look|review|take a look)/i;

async function callOpenRouter(messages: ChatMessage[]) {
  const reply = await callModel(messages, toolDefinitions);
  return reply.message;
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

/**
 * Saves the turn's plan as the one live confirmation card and retires any older
 * one. Confirming two versions of the same schedule is what tripled the events.
 *
 * `actions` must already be in final order (see {@link sortPlan}): the issue
 * indexes point at positions in this exact array.
 */
export function createPendingCard(
  actions: PlanAction[],
  issues: PlanIssue[] = [],
): PendingRequest {
  const superseded = db
    .select({ id: schema.pendingActions.id })
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.status, "pending"))
    .all();

  const blocked = hasErrors(issues);
  const summary = renderPlan(actions, issues) + (blocked ? `\n\n${t("planBlocked")}` : "");
  const row = db
    .insert(schema.pendingActions)
    .values({
      actionsJson: JSON.stringify(actions),
      summary,
      createdAt: new Date().toISOString(),
      // A plan with errors is shown but never becomes confirmable.
      status: blocked ? "blocked" : "pending",
      blocked: blocked ? 1 : 0,
    })
    .returning()
    .get();

  const olderIds = superseded.map((r) => r.id).filter((id) => id !== row.id);
  if (olderIds.length) {
    db.update(schema.pendingActions)
      .set({ status: "superseded" })
      .where(inArray(schema.pendingActions.id, olderIds))
      .run();
  }
  return { id: row.id, summary, supersededIds: olderIds, blocked };
}

/** Links a card to the Telegram message showing it, so it can be edited later. */
export function attachCardMessage(id: number, chatId: string, messageId: number): void {
  db.update(schema.pendingActions)
    .set({ chatId, messageId })
    .where(eq(schema.pendingActions.id, id))
    .run();
}

export function cardMessage(id: number): { chatId: string; messageId: number; summary: string } | null {
  const row = db
    .select()
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.id, id))
    .get();
  if (!row?.chatId || !row.messageId) return null;
  return { chatId: row.chatId, messageId: row.messageId, summary: row.summary };
}

/** Runs the tool-calling loop for one user message. */
export async function runAgent(userMessage: string): Promise<AgentResult> {
  const ctx: ToolContext = { mutated: [] };
  const userMsg: ChatMessage = { role: "user", content: userMessage };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...loadHistory(),
    userMsg,
  ];

  saveMessage(userMsg);
  let corrected = false;
  let claimFixed = false;
  let nudgedToWork = false;
  let revisions = 0;
  let modelCalls = 0;
  // Validation hits Google once per day touched: do not repeat it for a plan
  // that has not changed (the wording nudges below loop without touching it).
  let validatedKey: string | null = null;
  let validatedIssues: PlanIssue[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const msg = await callOpenRouter(messages);
    modelCalls++;
    messages.push(msg);
    saveMessage(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = msg.content?.trim() || t("agentDone");
      const staged = sortPlan(ctx.staged ?? []);

      // Before answering, check the plan against the real calendar and give the
      // model a chance to fix its own mistakes. This is the second pass that was
      // missing: one shot to plan, one to correct it with real data.
      let issues: PlanIssue[] = [];
      if (staged.length) {
        const key = JSON.stringify(staged);
        if (validatedKey !== key) {
          validatedKey = key;
          validatedIssues = await validatePlan(staged);
        }
        issues = validatedIssues;
        if (issues.length && revisions < MAX_PLAN_REVISIONS) {
          console.warn(`[agent] plan revision ${revisions + 1}: ${issues.length} issue(s)`);
          revisions++;
          ctx.staged = [];
          messages.push({
            role: "system",
            content:
              "REVISIÓN DEL PLAN (verificado contra el calendario real). Problemas encontrados:\n" +
              issuesForModel(staged, issues) +
              "\n\nVolvé a proponer el plan COMPLETO y corregido llamando a las tools de nuevo " +
              "(ERROR = hay que arreglarlo sí o sí; ADVERTENCIA = está permitido, pero avisale al usuario en tu respuesta). " +
              "Si un id ya no existe, releé el calendario con get_events antes de tocarlo.",
          });
          continue;
        }
      }

      // A staged plan is NOT done: saying "listo ✅" next to a card that asks for
      // confirmation is exactly the "it acts and then asks" complaint.
      if (!claimFixed && staged.length > 0 && !ctx.executed?.length && CLAIMS_DONE.test(text)) {
        claimFixed = true;
        // Only the wording is being fixed: the plan below must not grow.
        ctx.planFrozen = true;
        console.warn(`[agent] claims a staged plan is done: "${text.slice(0, 80)}"`);
        messages.push({
          role: "system",
          content:
            "ALTO: lo que anotaste está PENDIENTE de confirmación, no hecho. El usuario todavía no tocó Confirmar. " +
            "Reescribí tu respuesta en futuro/propuesta ('te propongo...', 'si confirmas, queda...'), sin 'listo', " +
            "'ya lo agendé' ni ✅. No vuelvas a llamar herramientas: el plan ya está anotado.",
        });
        continue;
      }

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

      // Announced work ("déjame revisar tu calendario") with no tool call: make
      // it actually do it instead of ending the turn on a promise.
      if (!nudgedToWork && ctx.mutated!.length === 0 && !ctx.readDays?.size && PROMISES_ACTION.test(text)) {
        nudgedToWork = true;
        console.warn(`[agent] promise without action, pushing it to work: "${text.slice(0, 80)}"`);
        messages.push({
          role: "system",
          content:
            "Dijiste que ibas a revisar/verificar algo pero no llamaste ninguna herramienta, y el usuario no ve pasos intermedios: " +
            "para él tu mensaje es la respuesta final. Hacelo AHORA (get_events, find_free_slots, list_tasks, lo que corresponda) " +
            "y respondé recién cuando tengas los datos.",
        });
        continue;
      }

      const pending: PendingRequest[] = [];
      if (staged.length) pending.push(createPendingCard(staged, issues));
      console.log(
        `[agent] turn finished: ${modelCalls} model call(s), ${ctx.mutated!.length} tool mutation(s), ` +
          `${staged.length} staged action(s), ${revisions} revision(s)`,
      );
      return { text, pending };
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

  // Out of steps: whatever was staged is still offered rather than thrown away.
  const staged = sortPlan(ctx.staged ?? []);
  const pending: PendingRequest[] = [];
  if (staged.length) pending.push(createPendingCard(staged, await validatePlan(staged)));
  const text = t("agentTooManySteps");
  saveMessage({ role: "assistant", content: text });
  return { text, pending };
}

export { OpenRouterError };

/** Turns an agent failure into something the user can act on. */
export function describeAgentError(err: unknown): string {
  if (err instanceof OpenRouterError) return t("agentError", { message: err.userHint });
  return t("agentError", { message: (err as Error).message });
}

export interface PendingOutcome {
  status: "done" | "gone" | "expired" | "blocked";
  text: string;
}

/** A card older than this is stale: the calendar may have moved on since. */
const PENDING_TTL_HOURS = 12;

/** Runs the actions of a confirmed pending_action. Returns a summary per action. */
export async function executePendingAction(pendingId: number): Promise<PendingOutcome> {
  const row = db
    .select()
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.id, pendingId))
    .get();
  if (!row || row.status !== "pending") {
    if (row?.status === "superseded") return { status: "gone", text: t("planSuperseded") };
    if (row?.status === "blocked") return { status: "blocked", text: t("planBlocked") };
    if (row?.status === "expired") return { status: "expired", text: t("planExpired", { hours: PENDING_TTL_HOURS }) };
    return { status: "gone", text: t("pendingGone") };
  }

  const ageHours = (Date.now() - new Date(row.createdAt).getTime()) / 3_600_000;
  if (ageHours > PENDING_TTL_HOURS) {
    db.update(schema.pendingActions)
      .set({ status: "expired" })
      .where(eq(schema.pendingActions.id, pendingId))
      .run();
    return { status: "expired", text: t("planExpired", { hours: PENDING_TTL_HOURS }) };
  }

  if (row.blocked) {
    return { status: "blocked", text: t("planBlocked") };
  }

  // Consume BEFORE running: if the process dies halfway through, a redelivered
  // callback must not re-run everything (it would duplicate events).
  db.update(schema.pendingActions)
    .set({ status: "confirmed" })
    .where(eq(schema.pendingActions.id, pendingId))
    .run();

  const actions = JSON.parse(row.actionsJson) as PlanAction[];
  const ctx: ToolContext = { confirmed: true };
  const results: ActionResult[] = [];
  for (const [index, action] of actions.entries()) {
    const label = describeAction(action);
    try {
      const result = (await executeTool(action.tool, action.args, ctx)) as Record<string, unknown>;
      if (result?.skipped_duplicate) results.push({ index, outcome: "skipped_duplicate", label });
      else if (result?.gone) results.push({ index, outcome: "gone", label });
      else if (result?.conflict) results.push({ index, outcome: "conflict", label });
      else if (action.tool.startsWith("delete_")) results.push({ index, outcome: "deleted", label });
      else if (action.tool.startsWith("update_")) results.push({ index, outcome: "updated", label });
      else results.push({ index, outcome: "created", label });
    } catch (err) {
      results.push({ index, outcome: "failed", label, detail: (err as Error).message });
    }
  }
  return { status: "done", text: renderResults(results) };
}

export async function cancelPendingAction(pendingId: number): Promise<void> {
  db.update(schema.pendingActions)
    .set({ status: "cancelled" })
    .where(eq(schema.pendingActions.id, pendingId))
    .run();
}

/** Retires every live card (used when the conversation is reset). */
export function dropPendingCards(): void {
  db.update(schema.pendingActions)
    .set({ status: "cancelled" })
    .where(eq(schema.pendingActions.status, "pending"))
    .run();
}
