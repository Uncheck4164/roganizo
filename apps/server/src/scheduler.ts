import { and, isNull, lte } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "./db/index.js";
import { config } from "./config.js";
import { locale, t } from "./i18n.js";
import { sendReminderAttempt, sendToUser } from "./bot/bot.js";
import { isGoogleConnected } from "./google/auth.js";
import { listEvents } from "./google/calendar.js";
import { listTasks } from "./google/tasks.js";

let lastBriefingDate: string | null = null;

// Urgent reminders: a single heads-up 5 min before the target time; if it is not
// acknowledged, a phone call exactly at that time (an earlier warning is
// forgotten again).
const RETRY_MINUTES = 5;
const MAX_ATTEMPTS = 1;

/** Telegram phone call through CallMeBot (TTS voice reading the reminder). */
async function callViaCallMeBot(message: string) {
  if (!config.CALLMEBOT_USER) return false;
  const url =
    `http://api.callmebot.com/start.php?user=${encodeURIComponent(config.CALLMEBOT_USER)}` +
    `&text=${encodeURIComponent(t("callPrefix", { message }).slice(0, 256))}` +
    `&lang=${t("callVoice")}&rpt=2&cc=missed`;
  try {
    const res = await fetch(url);
    return res.ok;
  } catch (err) {
    console.error("CallMeBot failed:", (err as Error).message);
    return false;
  }
}

async function fireDueReminders() {
  const nowDT = DateTime.now().setZone(config.TIMEZONE);
  const nowISO = nowDT.toISO()!;
  // Urgent reminders start warning BEFORE the target time, so the call (the last
  // escalation step) lands exactly on time when there is no acknowledgement.
  const lookaheadISO = nowDT.plus({ minutes: RETRY_MINUTES * MAX_ATTEMPTS }).toISO()!;
  const due = db
    .select()
    .from(schema.reminders)
    .where(and(isNull(schema.reminders.firedAt), lte(schema.reminders.fireAt, lookaheadISO)))
    .all();

  for (const r of due) {
    const fireAt = DateTime.fromISO(r.fireAt).setZone(config.TIMEZONE);

    // Normal: a single message at the exact time and done.
    if (!r.urgent) {
      if (fireAt > nowDT) continue;
      // Mark before sending: a missed reminder beats one repeating in a loop
      db.update(schema.reminders)
        .set({ firedAt: nowISO })
        .where(eq(schema.reminders.id, r.id))
        .run();
      await sendToUser(t("reminder", { message: r.message }));
      continue;
    }

    // Urgent: warnings from (time - 15 min), phone call at the target time.
    if (r.ackedAt) continue; // acknowledged between ticks

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
        t("reminderUrgentAttempt", { time: hhmm, message: r.message }),
      );
    } else if (nowDT >= fireAt) {
      // Target time reached without acknowledgement -> call and close.
      db.update(schema.reminders)
        .set({ firedAt: nowISO })
        .where(eq(schema.reminders.id, r.id))
        .run();
      const called = await callViaCallMeBot(r.message);
      await sendToUser(
        called
          ? t("reminderCalled", { time: hhmm, message: r.message })
          : t("reminderNotCalled", { time: hhmm, message: r.message }),
      );
    }
  }
}

async function maybeSendBriefing() {
  if (!config.BRIEFING_TIME || !isGoogleConnected()) return;
  const now = DateTime.now().setZone(config.TIMEZONE);
  const today = now.toISODate()!;
  if (lastBriefingDate === today) return;
  // 10 min window: a 60s tick never misses it, and a restart mid-afternoon does
  // not send the briefing outside its slot.
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
  const lines: string[] = [
    t("briefingHeader", {
      date: now.setLocale(locale()).toFormat(t("briefingDateFormat")),
    }),
  ];

  lines.push("", t("briefingToday"));
  lines.push(
    events.length
      ? events.map((e) => `  ${fmt(e.start)}–${fmt(e.end)}  ${e.title}`).join("\n")
      : t("briefingNothing"),
  );

  const pendingTasks = tasks.filter((task) => !task.completed);
  if (pendingTasks.length) {
    lines.push("", t("briefingTasks"));
    lines.push(pendingTasks.map((task) => `  • ${task.title}`).join("\n"));
  }

  if (todayReminders.length) {
    lines.push("", t("briefingReminders"));
    lines.push(todayReminders.map((r) => `  ${fmt(r.fireAt)}  ${r.message}`).join("\n"));
  }

  await sendToUser(lines.join("\n"));
}

export function startScheduler() {
  setInterval(() => {
    fireDueReminders().catch((err) => console.error("Reminder error:", err));
    maybeSendBriefing().catch((err) => console.error("Briefing error:", err));
  }, 60_000);
}
