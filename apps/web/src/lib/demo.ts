// Demo mode (GitHub Pages): fake in-memory data, no backend and no login.
// Every string follows the language currently stored under `rg-lang`.
import type { ApiEvent, ApiNote, ApiStats, ApiStatus, ApiTask } from "./api";
import { readLang, type Lang } from "./i18n";
import type { SettingsPayload, SetupStatus } from "./settings";

export const DEMO = import.meta.env.VITE_DEMO === "1";

interface Slot {
  dow: number; // 1 = Monday ... 7 = Sunday
  s: string;
  e: string;
  subject: SubjectKey;
  room?: string;
}

type SubjectKey =
  | "science"
  | "math"
  | "history"
  | "biology"
  | "lunch"
  | "study"
  | "physics"
  | "music"
  | "english"
  | "art"
  | "gym";

const SUBJECTS: Record<Lang, Record<SubjectKey, string>> = {
  es: {
    science: "Ciencias",
    math: "Matemática",
    history: "Historia",
    biology: "Biología",
    lunch: "Almuerzo",
    study: "Estudiar",
    physics: "Física",
    music: "Música",
    english: "Inglés",
    art: "Arte",
    gym: "Gimnasio",
  },
  en: {
    science: "Science",
    math: "Maths",
    history: "History",
    biology: "Biology",
    lunch: "Lunch",
    study: "Study",
    physics: "Physics",
    music: "Music",
    english: "English",
    art: "Art",
    gym: "Gym",
  },
};

// 100% fictional timetable (the design mockup's), unrelated to any real data.
const SCHEDULE: Slot[] = [
  { dow: 1, s: "08:00", e: "09:00", subject: "science", room: "A-101" },
  { dow: 1, s: "09:00", e: "10:00", subject: "math", room: "A-102" },
  { dow: 1, s: "11:00", e: "12:00", subject: "history", room: "B-201" },
  { dow: 2, s: "15:00", e: "16:30", subject: "biology", room: "Lab 2" },
  { dow: 2, s: "16:30", e: "16:50", subject: "lunch" },
  { dow: 2, s: "16:50", e: "18:20", subject: "study" },
  { dow: 3, s: "10:00", e: "11:00", subject: "physics", room: "C-301" },
  { dow: 3, s: "12:00", e: "13:00", subject: "music", room: "Aula Magna" },
  { dow: 4, s: "08:00", e: "09:00", subject: "science", room: "A-101" },
  { dow: 4, s: "14:00", e: "15:30", subject: "english", room: "B-105" },
  { dow: 5, s: "09:00", e: "10:00", subject: "math", room: "A-102" },
  { dow: 5, s: "11:00", e: "12:30", subject: "art", room: "Taller 1" },
  { dow: 6, s: "10:00", e: "11:00", subject: "gym" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localISO(d: Date, hhmm: string) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}:00`;
}

function roomLabel(room: string, lang: Lang) {
  return lang === "es" ? `Sala ${room}` : `Room ${room}`;
}

function eventsBetween(fromISO: string, toISO: string, lang: Lang): ApiEvent[] {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const out: ApiEvent[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor < to) {
    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
    for (const s of SCHEDULE) {
      if (s.dow !== dow) continue;
      out.push({
        id: `demo-${s.subject}-${cursor.toDateString()}-${s.s}`,
        title: SUBJECTS[lang][s.subject],
        start: localISO(cursor, s.s),
        end: localISO(cursor, s.e),
        recurring: true,
        description: s.room ? roomLabel(s.room, lang) : undefined,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.filter((e) => new Date(e.end) > from && new Date(e.start) < to);
}

const daysFromNow = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString();
};

// The "Prioridad: X" prefix is the wire format the bot writes into Google Tasks,
// so it stays in Spanish in both languages; only the prose after it is localised.
function tasks(lang: Lang): ApiTask[] {
  return lang === "es"
    ? [
        {
          id: "t1",
          title: "Entregar informe de Biología",
          notes: "Prioridad: Alta\nFotosíntesis C3 vs C4, mínimo 4 páginas.",
          due: daysFromNow(2),
          completed: false,
        },
        {
          id: "t2",
          title: "Repasar derivadas para la prueba",
          notes: "Prioridad: Alta\nRegla de la cadena y aplicaciones.",
          due: daysFromNow(4),
          completed: false,
        },
        {
          id: "t3",
          title: "Comprar cuaderno cuadriculado",
          notes: "Prioridad: Media",
          due: daysFromNow(3),
          completed: false,
        },
        { id: "t4", title: "Llamar al dentista", notes: "Prioridad: Baja", completed: false },
        { id: "t5", title: "Inscribirme al curso de inglés", due: daysFromNow(-2), completed: true },
        { id: "t6", title: "Pagar la cuota del gimnasio", due: daysFromNow(-4), completed: true },
      ]
    : [
        {
          id: "t1",
          title: "Hand in the Biology report",
          notes: "Prioridad: Alta\nC3 vs C4 photosynthesis, four pages minimum.",
          due: daysFromNow(2),
          completed: false,
        },
        {
          id: "t2",
          title: "Go over derivatives for the test",
          notes: "Prioridad: Alta\nChain rule and its applications.",
          due: daysFromNow(4),
          completed: false,
        },
        {
          id: "t3",
          title: "Buy a squared notebook",
          notes: "Prioridad: Media",
          due: daysFromNow(3),
          completed: false,
        },
        { id: "t4", title: "Call the dentist", notes: "Prioridad: Baja", completed: false },
        { id: "t5", title: "Sign up for the English course", due: daysFromNow(-2), completed: true },
        { id: "t6", title: "Pay the gym fee", due: daysFromNow(-4), completed: true },
      ];
}

function notes(lang: Lang): ApiNote[] {
  const rows =
    lang === "es"
      ? [
          {
            title: "Método de estudio",
            body: "Bloques de 45 min con 10 de pausa. Después de clase funciona mejor que a la mañana.",
          },
          { title: "Ideas para el TP", body: "Comparar fotosíntesis C3 y C4. Pedir bibliografía el martes." },
          { title: "Libros pendientes", body: "Terminar el de historia antes del segundo semestre." },
          { title: "Regalo de cumple", body: "A mamá le gustó la maceta de cerámica de la feria." },
        ]
      : [
          {
            title: "Study method",
            body: "45-minute blocks with a 10-minute break. After class works better than in the morning.",
          },
          { title: "Ideas for the project", body: "Compare C3 and C4 photosynthesis. Ask for the reading list on Tuesday." },
          { title: "Books to finish", body: "Finish the history one before the second term starts." },
          { title: "Birthday present", body: "Mum liked the ceramic planter from the fair." },
        ];
  const ages = [-1, -2, -5, -7];
  return rows.map((r, i) => ({
    id: i + 1,
    title: r.title,
    body: r.body,
    createdAt: daysFromNow(ages[i] ?? -1),
    updatedAt: daysFromNow(ages[i] ?? -1),
  }));
}

function reminders(lang: Lang) {
  return lang === "es"
    ? [
        { id: 1, message: "📞 Hablar con el profesor por la bibliografía", fireAt: daysFromNow(1) },
        { id: 2, message: "📚 Prueba de Matemática — repasar antes", fireAt: daysFromNow(4) },
      ]
    : [
        { id: 1, message: "📞 Talk to the teacher about the reading list", fireAt: daysFromNow(1) },
        { id: 2, message: "📚 Maths test — revise beforehand", fireAt: daysFromNow(4) },
      ];
}

function stats(lang: Lang): ApiStats {
  const hours = new Map<string, number>();
  for (const s of SCHEDULE) {
    const [sh, sm] = s.s.split(":").map(Number);
    const [eh, em] = s.e.split(":").map(Number);
    const h = eh! + em! / 60 - (sh! + sm! / 60);
    const title = SUBJECTS[lang][s.subject];
    hours.set(title, (hours.get(title) ?? 0) + h);
  }
  const byActivity = [...hours.entries()]
    .map(([title, h]) => ({ title, hours: Math.round(h * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const all = tasks(lang);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
    byActivity,
    totalHours: Math.round(byActivity.reduce((a, x) => a + x.hours, 0) * 10) / 10,
    tasks: { total: all.length, completed: all.filter((t) => t.completed).length },
  };
}

// Plausible configured instance so the Pages demo shows the full Settings UI.
// Secrets come back empty with a 4-char hint, exactly like the real server.
function settings(lang: Lang): SettingsPayload {
  return {
    setupRequired: false,
    values: {
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ALLOWED_USER_ID: "482915773",
      CALLMEBOT_USER: "@rogan",
      OPENROUTER_API_KEY: "",
      OPENROUTER_MODEL: "deepseek/deepseek-chat",
      OPENROUTER_PROVIDER_ORDER: "deepinfra,baidu",
      OPENROUTER_SORT: "price",
      GOOGLE_CLIENT_ID: "918273645012-a7f3k9d2m.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "",
      PUBLIC_URL: "https://roganizo.demo.dev",
      PORT: "8080",
      DATABASE_PATH: "/data/roganizo.db",
      WEB_PASSWORD: "",
      TIMEZONE: "America/Santiago",
      BRIEFING_TIME: "07:30",
      LANGUAGE: lang,
    },
    meta: {
      TELEGRAM_BOT_TOKEN: { secret: true, configured: true, source: "db", group: "telegram", hint: "PqU7" },
      TELEGRAM_ALLOWED_USER_ID: { secret: false, configured: true, source: "db", group: "telegram" },
      CALLMEBOT_USER: { secret: false, configured: true, source: "db", group: "telegram" },
      OPENROUTER_API_KEY: { secret: true, configured: true, source: "db", group: "model", hint: "e05a" },
      OPENROUTER_MODEL: { secret: false, configured: true, source: "db", group: "model" },
      OPENROUTER_PROVIDER_ORDER: { secret: false, configured: true, source: "db", group: "model" },
      OPENROUTER_SORT: { secret: false, configured: true, source: "default", group: "model" },
      GOOGLE_CLIENT_ID: { secret: false, configured: true, source: "db", group: "google" },
      GOOGLE_CLIENT_SECRET: { secret: true, configured: true, source: "db", group: "google", hint: "3gH" },
      PUBLIC_URL: { secret: false, configured: true, source: "env", group: "server" },
      PORT: { secret: false, configured: true, source: "env", group: "server", envOnly: true },
      DATABASE_PATH: { secret: false, configured: true, source: "env", group: "server", envOnly: true },
      WEB_PASSWORD: { secret: true, configured: true, source: "db", group: "web", hint: "nube" },
      TIMEZONE: { secret: false, configured: true, source: "db", group: "preferences" },
      BRIEFING_TIME: { secret: false, configured: true, source: "db", group: "preferences" },
      LANGUAGE: { secret: false, configured: true, source: "db", group: "preferences" },
    },
  };
}

export function demoFetch<T>(url: string): Promise<T> {
  const u = new URL(url, "http://demo.local");
  const path = u.pathname;
  const lang = readLang();
  let data: unknown;
  if (path === "/api/status") {
    data = {
      ok: true,
      google: true,
      timezone: "America/Santiago",
      now: new Date().toISOString(),
    } satisfies ApiStatus;
  } else if (path === "/setup/status") {
    data = { setupRequired: false, passwordSet: true, missing: [] } satisfies SetupStatus;
  } else if (path === "/api/settings") {
    data = settings(lang);
  } else if (path === "/api/events") {
    data = eventsBetween(u.searchParams.get("from")!, u.searchParams.get("to")!, lang);
  } else if (path === "/api/tasks") {
    data = tasks(lang);
  } else if (path === "/api/notes") {
    data = notes(lang);
  } else if (path === "/api/reminders") {
    data = reminders(lang);
  } else if (path === "/api/stats") {
    data = stats(lang);
  } else {
    data = { error: "not found" };
  }
  return new Promise((resolve) => setTimeout(() => resolve(data as T), 120));
}
