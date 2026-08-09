export interface ApiEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  recurring: boolean;
  description?: string;
}

export interface ApiTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  completed: boolean;
}

export interface ApiNote {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiStats {
  weekStart: string;
  weekEnd: string;
  byActivity: { title: string; hours: number }[];
  totalHours: number;
  tasks: { total: number; completed: number };
}

export interface ApiStatus {
  ok: boolean;
  google: boolean;
  timezone: string;
  now: string;
}

export class UnauthorizedError extends Error {}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) throw new UnauthorizedError("no session");
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    credentials: "same-origin",
  });
  return res.ok;
}

/** Prioridad codificada en las notes de Google Tasks: "Prioridad: Alta" en la primera línea. */
export function taskPriority(t: ApiTask): "Alta" | "Media" | "Baja" | null {
  const m = t.notes?.match(/^Prioridad:\s*(Alta|Media|Baja)/i);
  if (!m) return null;
  const p = m[1]!.toLowerCase();
  return p === "alta" ? "Alta" : p === "media" ? "Media" : "Baja";
}

export function taskDescription(t: ApiTask): string {
  return (t.notes ?? "").replace(/^Prioridad:\s*(Alta|Media|Baja)\s*\n?/i, "").trim();
}
