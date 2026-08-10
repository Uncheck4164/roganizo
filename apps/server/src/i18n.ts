import { config } from "./config.js";

/**
 * Every user-facing string of the bot lives here. Developer-facing logs stay in
 * English inline; only what the user reads on Telegram (or the OAuth pages)
 * goes through `t()`.
 *
 * Spanish is the default and is kept word for word identical to the original
 * hard-coded strings.
 */

const es = {
  startNeedsGoogle:
    "¡Hola! Soy Roganizo 🗓\n\nPara empezar necesito acceso a tu Google Calendar y Google Tasks. Entrá acá y aceptá:\n{url}\n\nCuando termines, mandame tu horario o lo que necesites.",
  startReady:
    "¡Hola! Soy Roganizo 🗓 Contame qué necesitás: crear tu horario, agendar algo, un recordatorio, una nota o un to-do.",
  webPanel: "Tu panel (solo lectura): {url}",
  historyReset: "Memoria de conversación borrada. Empezamos de cero 🙂",
  needsGoogle: "Primero conectá tu Google acá: {url} — después seguimos.",
  agentError: "Algo falló procesando eso 😞\n{message}",

  btnConfirm: "✅ Confirmar",
  btnCancel: "❌ Cancelar",
  btnSeen: "✅ Visto",
  toastExecuting: "Ejecutando...",
  toastCancelled: "Cancelado",
  toastAcked: "Confirmado 👍",
  markCancelled: "❌ Cancelado.",
  markSeen: "✅ Visto.",

  agentDone: "Listo.",
  agentTooManySteps:
    "Me quedé sin pasos para completar eso (demasiadas operaciones seguidas). Probá dividir el pedido.",
  pendingGone: "Esta acción ya no está pendiente.",
  batchConflict: "⚠️ {label}: no se creó, hay conflicto de horario.",

  reminder: "🔔 Recordatorio: {message}",
  reminderUrgentAttempt:
    '🚨 Recordatorio urgente ({time}): {message}\n\nTocá "Visto" o a las {time} te llamo.',
  reminderCalled:
    "📞 Son las {time} y no confirmaste, te estoy llamando por Telegram: {message}",
  reminderNotCalled:
    "🚨 Son las {time} y no confirmaste (no hay llamada configurada): {message}",
  callPrefix: "Recordatorio: {message}",
  callVoice: "es-ES-Standard-A",

  briefingHeader: "☀️ Buen día — {date}",
  briefingDateFormat: "cccc d 'de' LLLL",
  briefingToday: "📅 Hoy:",
  briefingNothing: "  Nada agendado.",
  briefingTasks: "✅ To-dos pendientes:",
  briefingReminders: "🔔 Recordatorios de hoy:",

  oauthMissingCode: "Falta el parámetro code",
  oauthSuccess: "✅ Google Calendar y Tasks conectados. Ya podés volver a Telegram.",
  oauthError: "Error conectando Google: {message}",
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  startNeedsGoogle:
    "Hi! I'm Roganizo 🗓\n\nTo get started I need access to your Google Calendar and Google Tasks. Open this and approve:\n{url}\n\nOnce you're done, send me your schedule or whatever you need.",
  startReady:
    "Hi! I'm Roganizo 🗓 Tell me what you need: build your schedule, book something, a reminder, a note or a to-do.",
  webPanel: "Your dashboard (read-only): {url}",
  historyReset: "Conversation memory wiped. Starting from scratch 🙂",
  needsGoogle: "First connect your Google here: {url} — then we can continue.",
  agentError: "Something went wrong with that 😞\n{message}",

  btnConfirm: "✅ Confirm",
  btnCancel: "❌ Cancel",
  btnSeen: "✅ Got it",
  toastExecuting: "Running...",
  toastCancelled: "Cancelled",
  toastAcked: "Confirmed 👍",
  markCancelled: "❌ Cancelled.",
  markSeen: "✅ Got it.",

  agentDone: "Done.",
  agentTooManySteps:
    "I ran out of steps to finish that (too many operations in a row). Try splitting the request.",
  pendingGone: "This action is no longer pending.",
  batchConflict: "⚠️ {label}: not created, there's a scheduling conflict.",

  reminder: "🔔 Reminder: {message}",
  reminderUrgentAttempt:
    '🚨 Urgent reminder ({time}): {message}\n\nTap "Got it" or I\'ll call you at {time}.',
  reminderCalled:
    "📞 It's {time} and you haven't confirmed, I'm calling you on Telegram: {message}",
  reminderNotCalled:
    "🚨 It's {time} and you haven't confirmed (no call configured): {message}",
  callPrefix: "Reminder: {message}",
  callVoice: "en-US-Standard-C",

  briefingHeader: "☀️ Good morning — {date}",
  briefingDateFormat: "cccc d LLLL",
  briefingToday: "📅 Today:",
  briefingNothing: "  Nothing scheduled.",
  briefingTasks: "✅ Pending to-dos:",
  briefingReminders: "🔔 Today's reminders:",

  oauthMissingCode: "Missing the code parameter",
  oauthSuccess: "✅ Google Calendar and Tasks connected. You can go back to Telegram.",
  oauthError: "Error connecting Google: {message}",
};

const tables: Record<"es" | "en", Record<MessageKey, string>> = { es, en };

/** Current UI language, read fresh so a settings change applies on next call. */
export function locale(): "es" | "en" {
  return config.LANGUAGE;
}

/** Translates a key, replacing {placeholders} with the given params. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = tables[locale()][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
