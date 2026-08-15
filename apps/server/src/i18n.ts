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
    "¡Hola! Soy Roganizo 🗓\n\nPara empezar necesito acceso a tu Google Calendar y Google Tasks. Entra aquí y acepta:\n{url}\n\nCuando termines, mándame tu horario o lo que necesites.",
  startReady:
    "¡Hola! Soy Roganizo 🗓 Cuéntame qué necesitas: crear tu horario, agendar algo, un recordatorio, una nota o un to-do.",
  webPanel: "Tu panel (solo lectura): {url}",
  historyReset: "Memoria de conversación borrada. Empezamos de cero 🙂",
  needsGoogle: "Primero conecta tu Google aquí: {url} — después seguimos.",
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
    "Me quedé sin pasos para completar eso (demasiadas operaciones seguidas). Prueba dividir el pedido.",
  pendingGone: "Esta acción ya no está pendiente.",
  batchConflict: "⚠️ {label}: no se creó, hay conflicto de horario.",

  // Confirmation card
  planHeader: "📋 Esto es lo que voy a hacer ({count}). Todavía NO toqué nada.",
  planDateFormat: "cccc d 'de' LLLL",
  planNoDate: "Sin fecha",
  planRepeats: "(se repite)",
  planWholeSeries: "(la serie repetida completa)",
  planUntitled: "(sin título)",
  planVerbCreate: "Crear",
  planVerbUpdate: "Mover/editar",
  planVerbDelete: "Borrar",
  planVerbRemind: "Recordar",
  planVerbTask: "To-do",
  planVerbComplete: "Completar",
  planFooter: "Toca ✅ Confirmar para aplicarlo, o ❌ Cancelar. Hasta que confirmes, tu calendario queda igual.",
  planSuperseded: "♻️ Reemplazado por una propuesta más nueva.",
  planExpired: "⌛ Esta propuesta venció (tiene más de {hours} h). Pídemela de nuevo y la recalculo.",
  planBlocked:
    "❗ No puedo aplicar esto: hay acciones marcadas con ❗ que ya no son válidas. Escríbeme de nuevo y lo recalculo con el calendario actual.",

  // Result block appended to the card after confirming
  resultsHeader: "Resultado:",
  resultsSummary: "{done} aplicadas · {skipped} omitidas · {failed} con error",
  outcome_created: "creado",
  outcome_updated: "actualizado",
  outcome_deleted: "borrado",
  outcome_skipped_duplicate: "ya existía, no lo dupliqué",
  outcome_gone: "ya no existía, no hice nada",
  outcome_conflict: "no se creó, choca con otro evento",
  outcome_failed: "error",

  // Plan validation
  issueNoId: "falta el id del evento",
  issueGone: "ese evento ya no existe en tu calendario",
  issueTitleMismatch: 'en el calendario ese evento se llama "{title}"',
  issueBadTime: "la fecha u hora no es válida",
  issueEndBeforeStart: "termina antes de empezar",
  issueRepeatedInPlan: "repetido: es lo mismo que la acción #{n}",
  issueSelfOverlap: "se pisa con la acción #{n} de este mismo plan",
  issueAlreadyExists: "ya existe idéntico en tu calendario — lo voy a omitir",
  issueOverlap: "se solapa con {title} ({time}){more}",
  issueCheckFailed: "no pude verificarlo contra el calendario ({message})",

  // Duplicate cleanup
  dupNone: "✨ No encontré eventos duplicados en los próximos {days} días.",
  dupFound:
    "🧹 Encontré {groups} evento(s) repetido(s) en los próximos {days} días. Te propongo dejar una sola copia de cada uno.",
  dupScanning: "Revisando tu calendario...",

  // Diagnostics
  diagRunning: "Probando OpenRouter...",
  diagOk: "✅ OpenRouter responde\nModelo: {model}\nProveedor: {provider}\nLatencia: {latency} ms{cost}",
  diagCost: "\nCosto de la prueba: ${cost}",
  diagFail: "❌ OpenRouter falló\nModelo: {model}\n{error}",

  reminder: "🔔 Recordatorio: {message}",
  reminderUrgentAttempt:
    '🚨 Recordatorio urgente ({time}): {message}\n\nToca "Visto" o a las {time} te llamo.',
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
  oauthSuccess: "✅ Google Calendar y Tasks conectados. Ya puedes volver a Telegram.",
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

  planHeader: "📋 Here's what I'm about to do ({count}). Nothing has changed yet.",
  planDateFormat: "cccc d LLLL",
  planNoDate: "No date",
  planRepeats: "(repeats)",
  planWholeSeries: "(the whole repeating series)",
  planUntitled: "(untitled)",
  planVerbCreate: "Create",
  planVerbUpdate: "Move/edit",
  planVerbDelete: "Delete",
  planVerbRemind: "Remind",
  planVerbTask: "To-do",
  planVerbComplete: "Complete",
  planFooter: "Tap ✅ Confirm to apply it, or ❌ Cancel. Until you confirm, your calendar stays as it is.",
  planSuperseded: "♻️ Replaced by a newer proposal.",
  planExpired: "⌛ This proposal expired (older than {hours} h). Ask me again and I'll recompute it.",
  planBlocked:
    "❗ I can't apply this: some actions marked ❗ are no longer valid. Message me again and I'll recompute it against your current calendar.",

  resultsHeader: "Result:",
  resultsSummary: "{done} applied · {skipped} skipped · {failed} failed",
  outcome_created: "created",
  outcome_updated: "updated",
  outcome_deleted: "deleted",
  outcome_skipped_duplicate: "already existed, not duplicated",
  outcome_gone: "no longer existed, nothing done",
  outcome_conflict: "not created, it clashes with another event",
  outcome_failed: "error",

  issueNoId: "the event id is missing",
  issueGone: "that event no longer exists in your calendar",
  issueTitleMismatch: 'in your calendar that event is called "{title}"',
  issueBadTime: "the date or time is not valid",
  issueEndBeforeStart: "it ends before it starts",
  issueRepeatedInPlan: "repeated: same as action #{n}",
  issueSelfOverlap: "clashes with action #{n} of this same plan",
  issueAlreadyExists: "an identical one already exists in your calendar — I'll skip it",
  issueOverlap: "overlaps {title} ({time}){more}",
  issueCheckFailed: "I couldn't verify it against the calendar ({message})",

  dupNone: "✨ No duplicated events in the next {days} days.",
  dupFound:
    "🧹 I found {groups} repeated event(s) in the next {days} days. Here's a cleanup that leaves one copy of each.",
  dupScanning: "Scanning your calendar...",

  diagRunning: "Testing OpenRouter...",
  diagOk: "✅ OpenRouter is responding\nModel: {model}\nProvider: {provider}\nLatency: {latency} ms{cost}",
  diagCost: "\nCost of this test: ${cost}",
  diagFail: "❌ OpenRouter failed\nModel: {model}\n{error}",

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
