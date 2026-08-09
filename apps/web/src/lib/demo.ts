// Modo demo (GitHub Pages): datos ficticios en memoria, sin backend ni login.
import type { ApiEvent, ApiNote, ApiStats, ApiStatus, ApiTask } from "./api";

export const DEMO = import.meta.env.VITE_DEMO === "1";

interface Slot {
  dow: number; // 1=lunes ... 7=domingo
  s: string;
  e: string;
  title: string;
  room?: string;
}

const SCHEDULE: Slot[] = [
  { dow: 1, s: "09:30", e: "10:50", title: "Gestión de Proyectos", room: "LC-48" },
  { dow: 1, s: "11:00", e: "12:20", title: "Empleabilidad", room: "SH-45" },
  { dow: 2, s: "11:00", e: "12:20", title: "Ciencia de Datos", room: "LC-48" },
  { dow: 2, s: "16:30", e: "17:30", title: "Estudiar" },
  { dow: 3, s: "09:30", e: "10:50", title: "Gestión de Proyectos", room: "LC-48" },
  { dow: 3, s: "11:00", e: "12:20", title: "Consultoría Informática", room: "LC-48" },
  { dow: 3, s: "12:30", e: "13:50", title: "Cálculo III", room: "SH-31" },
  { dow: 3, s: "17:40", e: "19:00", title: "Inglés III", room: "E35" },
  { dow: 4, s: "09:30", e: "10:50", title: "Ciencia de Datos", room: "L35" },
  { dow: 4, s: "14:00", e: "15:20", title: "Arquitectura de Software", room: "LC-48" },
  { dow: 4, s: "15:30", e: "16:50", title: "Consultoría Informática", room: "LC-44" },
  { dow: 5, s: "08:40", e: "10:50", title: "Cálculo III", room: "SC-39" },
  { dow: 5, s: "11:00", e: "12:20", title: "Arquitectura de Software", room: "LC-48" },
  { dow: 6, s: "10:00", e: "11:00", title: "Gimnasio" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localISO(d: Date, hhmm: string) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}:00`;
}

function eventsBetween(fromISO: string, toISO: string): ApiEvent[] {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const out: ApiEvent[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor < to) {
    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
    for (const s of SCHEDULE) {
      if (s.dow !== dow) continue;
      out.push({
        id: `demo-${s.title}-${cursor.toDateString()}-${s.s}`,
        title: s.title,
        start: localISO(cursor, s.s),
        end: localISO(cursor, s.e),
        recurring: true,
        description: s.room ? `Sala ${s.room}` : undefined,
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

const TASKS: ApiTask[] = [
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
];

const NOTES: ApiNote[] = [
  {
    id: 1,
    title: "Método de estudio",
    body: "Bloques de 45 min con 10 de pausa. Después de clase funciona mejor que a la mañana.",
    createdAt: daysFromNow(-1),
    updatedAt: daysFromNow(-1),
  },
  {
    id: 2,
    title: "Ideas para el TP",
    body: "Comparar fotosíntesis C3 y C4. Pedir bibliografía el martes.",
    createdAt: daysFromNow(-2),
    updatedAt: daysFromNow(-2),
  },
  {
    id: 3,
    title: "Libros pendientes",
    body: "Terminar el de historia antes del segundo semestre.",
    createdAt: daysFromNow(-5),
    updatedAt: daysFromNow(-5),
  },
  {
    id: 4,
    title: "Regalo de cumple",
    body: "A mamá le gustó la maceta de cerámica de la feria.",
    createdAt: daysFromNow(-7),
    updatedAt: daysFromNow(-7),
  },
];

const REMINDERS = [
  { id: 1, message: "📞 Hablar con el profesor por la bibliografía", fireAt: daysFromNow(1) },
  { id: 2, message: "💧 Prueba de Cálculo — repasar antes", fireAt: daysFromNow(4) },
];

function stats(): ApiStats {
  const hours = new Map<string, number>();
  for (const s of SCHEDULE) {
    const [sh, sm] = s.s.split(":").map(Number);
    const [eh, em] = s.e.split(":").map(Number);
    const h = eh! + em! / 60 - (sh! + sm! / 60);
    hours.set(s.title, (hours.get(s.title) ?? 0) + h);
  }
  const byActivity = [...hours.entries()]
    .map(([title, h]) => ({ title, hours: Math.round(h * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
    byActivity,
    totalHours: Math.round(byActivity.reduce((a, x) => a + x.hours, 0) * 10) / 10,
    tasks: { total: TASKS.length, completed: TASKS.filter((t) => t.completed).length },
  };
}

export function demoFetch<T>(url: string): Promise<T> {
  const u = new URL(url, "http://demo.local");
  const path = u.pathname;
  let data: unknown;
  if (path === "/api/status") {
    data = {
      ok: true,
      google: true,
      timezone: "America/Santiago",
      now: new Date().toISOString(),
    } satisfies ApiStatus;
  } else if (path === "/api/events") {
    data = eventsBetween(u.searchParams.get("from")!, u.searchParams.get("to")!);
  } else if (path === "/api/tasks") {
    data = TASKS;
  } else if (path === "/api/notes") {
    data = NOTES;
  } else if (path === "/api/reminders") {
    data = REMINDERS;
  } else if (path === "/api/stats") {
    data = stats();
  } else {
    data = { error: "not found" };
  }
  return new Promise((resolve) => setTimeout(() => resolve(data as T), 120));
}
