import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { isGoogleConnected } from "../google/auth.js";
import {
  cancelPendingAction,
  executePendingAction,
  resetHistory,
  runAgent,
} from "../agent/agent.js";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

/** El LLM insiste con markdown y Telegram lo muestra literal: se limpia siempre. */
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

// Mono-usuario: cualquier otro chat se ignora (se loguea el ID para poder
// configurar TELEGRAM_ALLOWED_USER_ID la primera vez).
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== config.TELEGRAM_ALLOWED_USER_ID) {
    console.log(
      `Mensaje ignorado de user ID ${ctx.from?.id} (@${ctx.from?.username ?? "sin username"})`,
    );
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  if (!isGoogleConnected()) {
    await ctx.reply(
      "¡Hola! Soy Roganizo 🗓\n\nPara empezar necesito acceso a tu Google Calendar y Google Tasks. Entrá acá y aceptá:\n" +
        `${config.PUBLIC_URL}/oauth/login\n\nCuando termines, mandame tu horario o lo que necesites.`,
    );
    return;
  }
  await ctx.reply(
    "¡Hola! Soy Roganizo 🗓 Contame qué necesitás: crear tu horario, agendar algo, un recordatorio, una nota o un to-do.",
  );
});

bot.command("web", async (ctx) => {
  await ctx.reply(`Tu panel (solo lectura): ${config.PUBLIC_URL}`);
});

bot.command("reset", async (ctx) => {
  resetHistory();
  await ctx.reply("Memoria de conversación borrada. Empezamos de cero 🙂");
});

bot.on("message:text", async (ctx) => {
  if (!isGoogleConnected()) {
    await ctx.reply(
      `Primero conectá tu Google acá: ${config.PUBLIC_URL}/oauth/login — después seguimos.`,
    );
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
          .text("✅ Confirmar", `confirm:${p.id}`)
          .text("❌ Cancelar", `cancel:${p.id}`),
      });
    }
  } catch (err) {
    clearInterval(typing);
    console.error("Error en el agente:", err);
    await ctx.reply(`Algo falló procesando eso 😞\n${(err as Error).message}`);
  }
});

bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: "Ejecutando..." });
  const lines = await executePendingAction(id);
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n${lines.join("\n")}`);
});

bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await cancelPendingAction(id);
  await ctx.answerCallbackQuery({ text: "Cancelado" });
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n❌ Cancelado.`);
});

// Confirmación de recordatorios urgentes: frena el escalado.
bot.callbackQuery(/^ack:(\d+)$/, async (ctx) => {
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../db/index.js");
  const id = Number(ctx.match[1]);
  const nowISO = new Date().toISOString();
  db.update(schema.reminders)
    .set({ ackedAt: nowISO, firedAt: nowISO })
    .where(eq(schema.reminders.id, id))
    .run();
  await ctx.answerCallbackQuery({ text: "Confirmado 👍" });
  await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n✅ Visto.`);
});

bot.catch((err) => {
  console.error("Error del bot:", err.error);
});

/** Para el scheduler: mandar mensajes proactivos al usuario. */
export async function sendToUser(text: string): Promise<void> {
  await bot.api.sendMessage(config.TELEGRAM_ALLOWED_USER_ID, text);
}

/** Recordatorio urgente con botón de confirmación. */
export async function sendReminderAttempt(reminderId: number, text: string): Promise<void> {
  await bot.api.sendMessage(config.TELEGRAM_ALLOWED_USER_ID, text, {
    reply_markup: new InlineKeyboard().text("✅ Visto", `ack:${reminderId}`),
  });
}
