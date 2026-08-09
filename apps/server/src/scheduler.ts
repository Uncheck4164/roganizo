import { and, isNull, lte } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "./db/index.js";
import { config } from "./config.js";
import { sendReminderAttempt, sendToUser } from "./bot/bot.js";
import { isGoogleConnected } from "./google/auth.js";
import { listEvents } from "./google/calendar.js";
import { listTasks } from "./google/tasks.js";

let lastBriefingDate: string | null = null;

// Urgentes: un solo aviso 5 min antes de la hora objetivo; si no se confirma,
// llamada a la hora exacta (un aviso más temprano se olvida de nuevo).
const RETRY_MINUTES = 5;
const MAX_ATTEMPTS = 1;

/** Llamada de Telegram vía CallMeBot (voz TTS leyendo el recordatorio). */
async function callViaCallMeBot(message: string) {
  if (!config.CALLMEBOT_USER) return false;
  const url =
    `http://api.callmebot.com/start.php?user=${encodeURIComponent(config.CALLMEBOT_USER)}` +
    `&text=${encodeURIComponent(`Recordatorio: ${message}`.slice(0, 256))}` +
    `&lang=es-ES-Standard-A&rpt=2&cc=missed`;
  try {
    const res = await fetch(url);
    return res.ok;
  } catch (err) {
    console.error("CallMeBot falló:", (err as Error).message);
    return false;
  }
}

async function fireDueReminders() {
  const nowDT = DateTime.now().setZone(config.TIMEZONE);
  const nowISO = nowDT.toISO()!;
  // Los urgentes empiezan a avisar ANTES de la hora objetivo, para que la
  // llamada (último escalón) caiga exactamente a la hora si no hay confirmación.
  const lookaheadISO = nowDT.plus({ minutes: RETRY_MINUTES * MAX_ATTEMPTS }).toISO()!;
  const due = db
    .select()
    .from(schema.reminders)
    .where(and(isNull(schema.reminders.firedAt), lte(schema.reminders.fireAt, lookaheadISO)))
    .all();

  for (const r of due) {
    const fireAt = DateTime.fromISO(r.fireAt).setZone(config.TIMEZONE);

    // Normal: un solo mensaje a la hora exacta y listo.
    if (!r.urgent) {
      if (fireAt > nowDT) continue;
      // Marcar antes de mandar: mejor un recordatorio perdido que uno repetido en loop
      db.update(schema.reminders)
        .set({ firedAt: nowISO })
        .where(eq(schema.reminders.id, r.id))
        .run();
      await sendToUser(`🔔 Recordatorio: ${r.message}`);
      continue;
    }

    // Urgente: avisos desde (hora - 15 min), llamada a la hora objetivo.
    if (r.ackedAt) continue; // confirmado entre ticks

    const hhmm = fireAt.toFormat("HH:mm");
    const minutesSinceLast = r.lastAttemptAt
      ? nowDT.diff(DateTime.fromISO(r.lastAttemptAt), "minutes").minutes
      : Infinity;

    if (r.attempts < MAX_ATTEMPTS) {
      if (minutesSinceLast < RETRY_MINUTES) continue;
      const n = r.attempts + 1;
      db.update(schema.reminders)
        .set({ attempts: n, lastAttemptAt: nowISO })
        .where(eq(schema.reminders.id, r.id))
        .run();
      await sendReminderAttempt(
        r.id,
        `🚨 Recordatorio urgente (${hhmm}): ${r.message}\n\nTocá "Visto" o a las ${hhmm} te llamo.`,
      );
    } else if (nowDT >= fireAt) {
      // Llegó la hora objetivo sin confirmación → llamada y cierre.
      db.update(schema.reminders)
        .set({ firedAt: nowISO })
        .where(eq(schema.reminders.id, r.id))
        .run();
      const called = await callViaCallMeBot(r.message);
      await sendToUser(
        called
          ? `📞 Son las ${hhmm} y no confirmaste, te estoy llamando por Telegram: ${r.message}`
          : `🚨 Son las ${hhmm} y no confirmaste (no hay llamada configurada): ${r.message}`,
      );
    }
  }
}

async function maybeSendBriefing() {
  if (!config.BRIEFING_TIME || !isGoogleConnected()) return;
  const now = DateTime.now().setZone(config.TIMEZONE);
  const today = now.toISODate()!;
  if (lastBriefingDate === today) return;
  // Ventana de 10 min: un tick de 60s nunca se lo pierde, y un reinicio
  // a media tarde no manda el briefing fuera de hora.
  const [h, m] = config.BRIEFING_TIME.split(":").map(Number);
  const target = (h ?? 0) * 60 + (m ?? 0);
  const cur = now.hour * 60 + now.minute;
  if (cur < target || cur >= target + 10) return;
  lastBriefingDate = today;

  const dayStart = now.startOf("day");
  const dayEnd = now.endOf("day");
  const [events, tasks] = await Promise.all([
    listEvents(dayStart.toISO()!, dayEnd.toISO()!),
    listTasks(false),
  ]);
  const todayReminders = db
    .select()
    .from(schema.reminders)
    .where(isNull(schema.reminders.firedAt))
    .all()
    .filter((r) => DateTime.fromISO(r.fireAt).setZone(config.TIMEZONE).toISODate() === today);

  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(config.TIMEZONE).toFormat("HH:mm");
  const lines: string[] = [`☀️ Buen día — ${now.setLocale("es").toFormat("cccc d 'de' LLLL")}`];

  lines.push("", "📅 Hoy:");
  lines.push(
    events.length
      ? events.map((e) => `  ${fmt(e.start)}–${fmt(e.end)}  ${e.title}`).join("\n")
      : "  Nada agendado.",
  );

  const pendingTasks = tasks.filter((t) => !t.completed);
  if (pendingTasks.length) {
    lines.push("", "✅ To-dos pendientes:");
    lines.push(pendingTasks.map((t) => `  • ${t.title}`).join("\n"));
  }

  if (todayReminders.length) {
    lines.push("", "🔔 Recordatorios de hoy:");
    lines.push(todayReminders.map((r) => `  ${fmt(r.fireAt)}  ${r.message}`).join("\n"));
  }

  await sendToUser(lines.join("\n"));
}

export function startScheduler() {
  setInterval(() => {
    fireDueReminders().catch((err) => console.error("Error en recordatorios:", err));
    maybeSendBriefing().catch((err) => console.error("Error en briefing:", err));
  }, 60_000);
}
