// Tiny hand-rolled i18n (es/en). No library: a typed dictionary plus a context.
// The chosen language is persisted in localStorage under `rg-lang`.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "es" | "en";

export const LANG_KEY = "rg-lang";

/** Stored choice, falling back to the browser language (es* -> es, anything else -> en). */
export function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "es" || stored === "en") return stored;
  } catch {
    /* localStorage can be unavailable in private modes */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav?.toLowerCase().startsWith("es") ? "es" : "en";
}

/** BCP-47 tag used for Intl formatting. */
export function intlLocale(lang: Lang): string {
  return lang === "es" ? "es-CL" : "en-US";
}

const es = {
  "greeting.morning": "Buenos días",
  "greeting.afternoon": "Buenas tardes",
  "greeting.night": "Buenas noches",

  "login.subtitle": "Panel de solo lectura",
  "login.password": "Contraseña",
  "login.submit": "Entrar",
  "login.error": "Contraseña incorrecta",

  "tab.cal": "Calendario",
  "tab.todos": "To-dos",
  "tab.notes": "Notas",
  "tab.stats": "Stats",

  "hdr.telegramOn": "Telegram conectado",
  "hdr.telegramOff": "Telegram sin conexión",
  "hdr.toLight": "Cambiar a modo claro",
  "hdr.toDark": "Cambiar a modo oscuro",
  "hdr.lang": "Cambiar a inglés",
  "hdr.settings": "Ajustes",
  "hdr.settingsClose": "Cerrar ajustes",

  "common.loading": "Cargando…",
  "common.hours": "h",

  "cal.now": "Ahora",
  "cal.free": "Un rato libre",
  "cal.remaining": "quedan {n} min",
  "cal.next": "A continuación",
  "cal.nothingElse": "Nada más por hoy.",
  "cal.inMin": "en {n} min",
  "cal.inHours": "en {n} h",
  "cal.filter.all": "Todo",
  "cal.filter.once": "Solo únicos",
  "cal.filter.weekly": "Solo repetidos",
  "cal.btn.today": "Hoy",
  "cal.btn.month": "Mes",
  "cal.btn.week": "Semana",
  "cal.btn.day": "Día",
  "cal.btn.list": "Lista",
  "cal.recurring": "Se repite cada semana",
  "cal.once": "Evento único",
  "cal.everyWeek": "cada semana",

  "todos.filter.all": "Todas",
  "todos.filter.high": "Prioridad alta",
  "todos.filter.week": "Esta semana",
  "todos.empty": "Nada pendiente por acá 🎉",
  "todos.reminders": "Recordatorios programados",
  "todos.done": "Completadas",
  "todos.noDue": "sin fecha",
  "prio.high": "Alta",
  "prio.medium": "Media",
  "prio.low": "Baja",

  "notes.empty": 'Sin notas todavía. Decile al bot "guardá una nota…" y aparece acá.',

  "stats.prevWeek": "Semana anterior",
  "stats.nextWeek": "Semana siguiente",
  "stats.thisWeek": "Esta semana",
  "stats.scheduledHours": "Horas agendadas",
  "stats.inTheWeek": "en la semana",
  "stats.todosDone": "To-dos completados",
  "stats.ofTotal": "{done} de {total}",
  "stats.distinct": "Actividades distintas",
  "stats.withTime": "con tiempo asignado",
  "stats.hoursByActivity": "Horas por actividad",
  "stats.noEvents": "Sin eventos esta semana.",

  "set.title": "Ajustes",
  "set.group.telegram": "Telegram",
  "set.group.model": "Modelo",
  "set.group.google": "Google",
  "set.group.server": "Servidor",
  "set.group.web": "Acceso web",
  "set.group.preferences": "Preferencias",
  "set.badge.ok": "Configurado",
  "set.badge.missing": "{n} sin configurar",
  "set.badge.envOnly": "Solo entorno",
  "set.save": "Guardar cambios",
  "set.saving": "Guardando…",
  "set.saved": "Guardado",
  "set.discard": "Descartar",
  "set.clean": "Sin cambios pendientes",
  "set.dirty.one": "1 cambio sin guardar",
  "set.dirty.many": "{n} cambios sin guardar",
  "set.reveal": "Mostrar",
  "set.hide": "Ocultar",
  "set.envOnly": "Definido por entorno · solo lectura",
  "set.secretKept": "Guardado, termina en {hint}",
  "set.secretEmpty": "Sin definir",
  "set.restartRequired": "Hay cambios que necesitan reiniciar el servicio.",
  "set.apply": "Aplicar y reiniciar",
  "set.restarting": "Reiniciando…",
  "set.restartingHint": "El servicio vuelve en unos segundos y la página se recarga sola.",
  "set.restartFailed": "El servicio no volvió a responder. Recargá la página en un momento.",
  "set.loadError": "No se pudieron cargar los ajustes.",
  "set.saveError": "No se pudieron guardar los cambios.",
  "set.demoReadOnly": "Demo — solo lectura",
  "set.help": "Cómo consigo esto",
  "set.helpClose": "Cerrar la ayuda",
  "set.lang.es": "Español",
  "set.lang.en": "Inglés",

  "setup.title": "Bienvenido a Roganizo",
  "setup.intro":
    "Antes de arrancar hay que cargar algunas credenciales. Se guardan en la base del contenedor y las podés cambiar cuando quieras desde este mismo panel.",
  "setup.checklist": "Falta completar",
  "setup.allSet": "Está todo cargado. Guardá para arrancar.",
  "setup.passwordRequired": "Definí una contraseña web para terminar.",
  "setup.finish": "Guardar y arrancar",

  "field.TELEGRAM_BOT_TOKEN.label": "Token del bot",
  "field.TELEGRAM_BOT_TOKEN.hint": "El que entrega @BotFather al crear el bot.",
  "field.TELEGRAM_ALLOWED_USER_ID.label": "Tu user ID",
  "field.TELEGRAM_ALLOWED_USER_ID.hint": "Único ID autorizado. El bot ignora a cualquier otra cuenta.",
  "field.CALLMEBOT_USER.label": "Usuario para llamadas",
  "field.CALLMEBOT_USER.hint": "Llamadas de urgencia a tu Telegram. Vacío desactiva las llamadas.",
  "field.OPENROUTER_API_KEY.label": "API key",
  "field.OPENROUTER_API_KEY.hint": "Clave de tu cuenta de OpenRouter.",
  "field.OPENROUTER_MODEL.label": "Modelo",
  "field.OPENROUTER_MODEL.hint": "Identificador del modelo que interpreta tus mensajes.",
  "field.OPENROUTER_PROVIDER_ORDER.label": "Orden de providers",
  "field.OPENROUTER_PROVIDER_ORDER.hint": "Proveedores preferidos, en orden y separados por coma.",
  "field.OPENROUTER_SORT.label": "Criterio de fallback",
  "field.OPENROUTER_SORT.hint": "Cómo elegir cuando el provider preferido no responde.",
  "field.GOOGLE_CLIENT_ID.label": "Client ID",
  "field.GOOGLE_CLIENT_ID.hint": "Credencial OAuth del proyecto en Google Cloud.",
  "field.GOOGLE_CLIENT_SECRET.label": "Client secret",
  "field.GOOGLE_CLIENT_SECRET.hint": "No vuelve a mostrarse completo: solo los últimos caracteres.",
  "field.PUBLIC_URL.label": "URL pública",
  "field.PUBLIC_URL.hint": "Base para el callback de OAuth y los links que manda el bot.",
  "field.PORT.label": "Puerto HTTP",
  "field.PORT.hint": "Puerto que expone el contenedor.",
  "field.DATABASE_PATH.label": "Ruta de la base",
  "field.DATABASE_PATH.hint": "Debe apuntar al volumen persistente del contenedor.",
  "field.WEB_PASSWORD.label": "Contraseña",
  "field.WEB_PASSWORD.hint": "La que pide esta web al entrar.",
  "field.TIMEZONE.label": "Zona horaria",
  "field.TIMEZONE.hint": "Resuelve “mañana”, “el martes” y las horas que dictás.",
  "field.BRIEFING_TIME.label": "Hora del briefing",
  "field.BRIEFING_TIME.hint": "Resumen diario por Telegram. Vacío lo desactiva.",
  "field.LANGUAGE.label": "Idioma",
  "field.LANGUAGE.hint": "Idioma del bot y de esta web.",
};

export type TKey = keyof typeof es;

const en: Record<TKey, string> = {
  "greeting.morning": "Good morning",
  "greeting.afternoon": "Good afternoon",
  "greeting.night": "Good evening",

  "login.subtitle": "Read-only dashboard",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.error": "Wrong password",

  "tab.cal": "Calendar",
  "tab.todos": "To-dos",
  "tab.notes": "Notes",
  "tab.stats": "Stats",

  "hdr.telegramOn": "Telegram connected",
  "hdr.telegramOff": "Telegram offline",
  "hdr.toLight": "Switch to light mode",
  "hdr.toDark": "Switch to dark mode",
  "hdr.lang": "Switch to Spanish",
  "hdr.settings": "Settings",
  "hdr.settingsClose": "Close settings",

  "common.loading": "Loading…",
  "common.hours": "h",

  "cal.now": "Now",
  "cal.free": "A free stretch",
  "cal.remaining": "{n} min left",
  "cal.next": "Up next",
  "cal.nothingElse": "Nothing else today.",
  "cal.inMin": "in {n} min",
  "cal.inHours": "in {n} h",
  "cal.filter.all": "All",
  "cal.filter.once": "One-off only",
  "cal.filter.weekly": "Recurring only",
  "cal.btn.today": "Today",
  "cal.btn.month": "Month",
  "cal.btn.week": "Week",
  "cal.btn.day": "Day",
  "cal.btn.list": "List",
  "cal.recurring": "Repeats every week",
  "cal.once": "One-off event",
  "cal.everyWeek": "every week",

  "todos.filter.all": "All",
  "todos.filter.high": "High priority",
  "todos.filter.week": "This week",
  "todos.empty": "Nothing pending here 🎉",
  "todos.reminders": "Scheduled reminders",
  "todos.done": "Completed",
  "todos.noDue": "no date",
  "prio.high": "High",
  "prio.medium": "Medium",
  "prio.low": "Low",

  "notes.empty": 'No notes yet. Tell the bot "save a note…" and it shows up here.',

  "stats.prevWeek": "Previous week",
  "stats.nextWeek": "Next week",
  "stats.thisWeek": "This week",
  "stats.scheduledHours": "Scheduled hours",
  "stats.inTheWeek": "this week",
  "stats.todosDone": "To-dos completed",
  "stats.ofTotal": "{done} of {total}",
  "stats.distinct": "Distinct activities",
  "stats.withTime": "with time assigned",
  "stats.hoursByActivity": "Hours by activity",
  "stats.noEvents": "No events this week.",

  "set.title": "Settings",
  "set.group.telegram": "Telegram",
  "set.group.model": "Model",
  "set.group.google": "Google",
  "set.group.server": "Server",
  "set.group.web": "Web access",
  "set.group.preferences": "Preferences",
  "set.badge.ok": "Configured",
  "set.badge.missing": "{n} to configure",
  "set.badge.envOnly": "Env only",
  "set.save": "Save changes",
  "set.saving": "Saving…",
  "set.saved": "Saved",
  "set.discard": "Discard",
  "set.clean": "No pending changes",
  "set.dirty.one": "1 unsaved change",
  "set.dirty.many": "{n} unsaved changes",
  "set.reveal": "Show",
  "set.hide": "Hide",
  "set.envOnly": "Set by the environment · read-only",
  "set.secretKept": "Saved, ends in {hint}",
  "set.secretEmpty": "Not set",
  "set.restartRequired": "Some of these changes need the service to restart.",
  "set.apply": "Apply & restart",
  "set.restarting": "Restarting…",
  "set.restartingHint": "The service comes back in a few seconds and the page reloads on its own.",
  "set.restartFailed": "The service did not answer again. Reload the page in a moment.",
  "set.loadError": "Could not load the settings.",
  "set.saveError": "Could not save the changes.",
  "set.demoReadOnly": "Demo — read only",
  "set.help": "How do I get this",
  "set.helpClose": "Close the help",
  "set.lang.es": "Spanish",
  "set.lang.en": "English",

  "setup.title": "Welcome to Roganizo",
  "setup.intro":
    "A few credentials are needed before the assistant can start. They are stored in the container database and you can change them any time from this same panel.",
  "setup.checklist": "Still missing",
  "setup.allSet": "Everything is filled in. Save to get started.",
  "setup.passwordRequired": "Set a web password to finish.",
  "setup.finish": "Save & start",

  "field.TELEGRAM_BOT_TOKEN.label": "Bot token",
  "field.TELEGRAM_BOT_TOKEN.hint": "The one @BotFather hands you when you create the bot.",
  "field.TELEGRAM_ALLOWED_USER_ID.label": "Your user ID",
  "field.TELEGRAM_ALLOWED_USER_ID.hint": "The only authorised ID. The bot ignores every other account.",
  "field.CALLMEBOT_USER.label": "Username for calls",
  "field.CALLMEBOT_USER.hint": "Urgent calls to your Telegram. Leave it empty to disable calls.",
  "field.OPENROUTER_API_KEY.label": "API key",
  "field.OPENROUTER_API_KEY.hint": "Key from your OpenRouter account.",
  "field.OPENROUTER_MODEL.label": "Model",
  "field.OPENROUTER_MODEL.hint": "Identifier of the model that reads your messages.",
  "field.OPENROUTER_PROVIDER_ORDER.label": "Provider order",
  "field.OPENROUTER_PROVIDER_ORDER.hint": "Preferred providers, in order, separated by commas.",
  "field.OPENROUTER_SORT.label": "Fallback criterion",
  "field.OPENROUTER_SORT.hint": "How to choose when the preferred provider does not answer.",
  "field.GOOGLE_CLIENT_ID.label": "Client ID",
  "field.GOOGLE_CLIENT_ID.hint": "OAuth credential of the project in Google Cloud.",
  "field.GOOGLE_CLIENT_SECRET.label": "Client secret",
  "field.GOOGLE_CLIENT_SECRET.hint": "Never shown in full again — only the last characters.",
  "field.PUBLIC_URL.label": "Public URL",
  "field.PUBLIC_URL.hint": "Base for the OAuth callback and for the links the bot sends.",
  "field.PORT.label": "HTTP port",
  "field.PORT.hint": "Port the container exposes.",
  "field.DATABASE_PATH.label": "Database path",
  "field.DATABASE_PATH.hint": "Must point at the container's persistent volume.",
  "field.WEB_PASSWORD.label": "Password",
  "field.WEB_PASSWORD.hint": "The one this site asks for when you sign in.",
  "field.TIMEZONE.label": "Time zone",
  "field.TIMEZONE.hint": "Resolves “tomorrow”, “on Tuesday” and the times you dictate.",
  "field.BRIEFING_TIME.label": "Briefing time",
  "field.BRIEFING_TIME.hint": "Daily summary over Telegram. Empty disables it.",
  "field.LANGUAGE.label": "Language",
  "field.LANGUAGE.hint": "Language for the bot and for this site.",
};

const DICTS: Record<Lang, Record<TKey, string>> = { es, en };

type Vars = Record<string, string | number>;

/** Replaces `{name}` placeholders. */
function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export type TFunction = (key: TKey, vars?: Vars) => string;

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
  /** BCP-47 tag for Intl formatters. */
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang());

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore */
    }
    setLangState(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => format(DICTS[lang][key], vars),
      locale: intlLocale(lang),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
