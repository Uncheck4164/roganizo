import { Bot, InlineKeyboard, type Context } from "grammy";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { t } from "../i18n.js";
import { isGoogleConnected } from "../google/auth.js";
import { findDuplicates } from "../google/calendar.js";
import { checkModel } from "../agent/openrouter.js";
import { sortPlan } from "../agent/plan.js";
import type { PendingRequest } from "../agent/tools/index.js";
import {
  attachCardMessage,
  cancelPendingAction,
  cardMessage,
  createPendingCard,
  describeAgentError,
  dropPendingCards,
  executePendingAction,
  resetHistory,
  runAgent,
} from "../agent/agent.js";

// The placeholder keeps the constructor from throwing while the app is still in
// setup mode; bot.start() is never called before the token is configured.
export const bot = new Bot(config.TELEGRAM_BOT_TOKEN || "0:SETUP_PLACEHOLDER");

/** The LLM insists on markdown and Telegram renders it literally: always strip it. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/g, "$1")
    .replace(/`{1,3}([^`]+?)`{1,3}/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

/** Telegram rejects anything longer than this, and a plan can get long. */
const TELEGRAM_LIMIT = 4096;

/** Splits on line breaks so a plan never loses its shape mid-message. */
function chunk(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // A single line over the limit is rare; hard-cut it rather than fail.
    const pieces = line.length > TELEGRAM_LIMIT ? (line.match(/.{1,4000}/gs) ?? [line]) : [line];
    for (const piece of pieces) {
      if (current.length + piece.length + 1 > TELEGRAM_LIMIT) {
        parts.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Sends possibly-long plain text; returns the last message sent. */
async function sendLong(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  const parts = chunk(stripMarkdown(text));
  let last;
  for (const [i, part] of parts.entries()) {
    const isLast = i === parts.length - 1;
    last = await ctx.reply(part, isLast && keyboard ? { reply_markup: keyboard } : {});
  }
  return last;
}

/**
 * Shows a confirmation card and retires the previous one. It goes out BEFORE
 * the assistant's own text so the user reads the actual plan first and never
 * sees a "done ✅" for something that has not happened yet.
 */
async function sendCard(ctx: Context, card: PendingRequest) {
  for (const oldId of card.supersededIds) {
    const old = cardMessage(oldId);
    if (!old) continue;
    await ctx.api
      .editMessageText(old.chatId, old.messageId, `${old.summary}\n\n${t("planSuperseded")}`)
      .catch(() => {}); // the message may be too old to edit
  }
  const keyboard = card.blocked
    ? undefined
    : new InlineKeyboard().text(t("btnConfirm"), `confirm:${card.id}`).text(t("btnCancel"), `cancel:${card.id}`);
  const sent = await sendLong(ctx, card.summary, keyboard);
  if (sent) attachCardMessage(card.id, String(sent.chat.id), sent.message_id);
}

let botRunning = false;
export const isBotRunning = () => botRunning;
export const setBotRunning = (v: boolean) => {
  botRunning = v;
};

// Single-user: every other chat is ignored (the ID is logged so that
// TELEGRAM_ALLOWED_USER_ID can be filled in the first time).
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== config.TELEGRAM_ALLOWED_USER_ID) {
    console.log(
      `Ignored message from user ID ${ctx.from?.id} (@${ctx.from?.username ?? "no username"})`,
    );
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  if (!isGoogleConnected()) {
    await ctx.reply(t("startNeedsGoogle", { url: `${config.PUBLIC_URL}/oauth/login` }));
    return;
  }
  await ctx.reply(t("startReady"));
});

bot.command("web", async (ctx) => {
  await ctx.reply(t("webPanel", { url: config.PUBLIC_URL }));
});

bot.command("reset", async (ctx) => {
  resetHistory();
  dropPendingCards();
  await ctx.reply(t("historyReset"));
});

/** How far ahead the duplicate scan looks. */
const DUPLICATE_SCAN_DAYS = 60;

// Cleanup for a calendar that already got messy: finds events repeated with the
// same title and time and proposes leaving exactly one copy of each.
bot.command(["duplicates", "duplicados"], async (ctx) => {
  if (!isGoogleConnected()) {
    await ctx.reply(t("needsGoogle", { url: `${config.PUBLIC_URL}/oauth/login` }));
    return;
  }
  await ctx.reply(t("dupScanning"));
  const from = DateTime.now().setZone(config.TIMEZONE).startOf("day");
  const report = await findDuplicates(
    from.toISO()!,
    from.plus({ days: DUPLICATE_SCAN_DAYS }).endOf("day").toISO()!,
  );
  if (!report.deletions.length) {
    await ctx.reply(t("dupNone", { days: DUPLICATE_SCAN_DAYS }));
    return;
  }
  await ctx.reply(t("dupFound", { groups: report.groups.length, days: DUPLICATE_SCAN_DAYS }));
  const card = createPendingCard(
    sortPlan(
      report.deletions.map((d) => ({
        tool: "delete_event",
        args: { event_id: d.id, title: d.title, start: d.when, series: d.kind === "series" },
      })),
    ),
  );
  await sendCard(ctx, card);
});

// Checks the model end to end: key, model id, routing and cost of one call.
bot.command("diag", async (ctx) => {
  await ctx.reply(t("diagRunning"));
  const result = await checkModel();
  await ctx.reply(
    result.ok
      ? t("diagOk", {
          model: result.model,
          provider: result.provider ?? "?",
          latency: result.latencyMs,
          cost: result.cost !== undefined ? t("diagCost", { cost: result.cost.toFixed(6) }) : "",
        })
      : t("diagFail", { model: result.model, error: result.error ?? "" }),
  );
});

bot.on("message:text", async (ctx) => {
  if (!isGoogleConnected()) {
    await ctx.reply(t("needsGoogle", { url: `${config.PUBLIC_URL}/oauth/login` }));
    return;
  }
  await ctx.replyWithChatAction("typing");
  const typing = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 5000);
  try {
    const result = await runAgent(ctx.message.text);
    clearInterval(typing);
    for (const card of result.pending) await sendCard(ctx, card);
    await sendLong(ctx, result.text);
  } catch (err) {
    clearInterval(typing);
    console.error("Agent error:", err);
    await ctx.reply(describeAgentError(err));
  }
});

bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: t("toastExecuting") });
  const outcome = await executePendingAction(id);
  const original = ctx.callbackQuery.message?.text ?? "";
  // Keeping both makes the message self-contained, but it must still fit.
  const full = `${original}\n\n${outcome.text}`;
  if (full.length <= TELEGRAM_LIMIT) {
    await ctx.editMessageText(full);
  } else {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await sendLong(ctx, outcome.text);
  }
});

bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await cancelPendingAction(id);
  await ctx.answerCallbackQuery({ text: t("toastCancelled") });
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n${t("markCancelled")}`);
});

// Acknowledgement of urgent reminders: stops the escalation.
bot.callbackQuery(/^ack:(\d+)$/, async (ctx) => {
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../db/index.js");
  const id = Number(ctx.match[1]);
  const nowISO = new Date().toISOString();
  db.update(schema.reminders)
    .set({ ackedAt: nowISO, firedAt: nowISO })
    .where(eq(schema.reminders.id, id))
    .run();
  await ctx.answerCallbackQuery({ text: t("toastAcked") });
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n${t("markSeen")}`);
});

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

/** For the scheduler: send proactive messages to the user. */
export async function sendToUser(text: string): Promise<void> {
  await bot.api.sendMessage(config.TELEGRAM_ALLOWED_USER_ID, text);
}

/** Urgent reminder with an acknowledgement button. */
export async function sendReminderAttempt(reminderId: number, text: string): Promise<void> {
  await bot.api.sendMessage(config.TELEGRAM_ALLOWED_USER_ID, text, {
    reply_markup: new InlineKeyboard().text(t("btnSeen"), `ack:${reminderId}`),
  });
}
