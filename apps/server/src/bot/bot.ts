import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { t } from "../i18n.js";
import { isGoogleConnected } from "../google/auth.js";
import {
  cancelPendingAction,
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
  await ctx.reply(t("historyReset"));
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
    await ctx.reply(stripMarkdown(result.text));
    for (const p of result.pending) {
      await ctx.reply(stripMarkdown(p.summary), {
        reply_markup: new InlineKeyboard()
          .text(t("btnConfirm"), `confirm:${p.id}`)
          .text(t("btnCancel"), `cancel:${p.id}`),
      });
    }
  } catch (err) {
    clearInterval(typing);
    console.error("Agent error:", err);
    await ctx.reply(t("agentError", { message: (err as Error).message }));
  }
});

bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: t("toastExecuting") });
  const lines = await executePendingAction(id);
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n${lines.join("\n")}`);
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
