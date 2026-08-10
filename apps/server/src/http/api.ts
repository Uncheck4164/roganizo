import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { desc, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "../db/index.js";
import { config, isPasswordConfigured } from "../config.js";
import { isGoogleConnected } from "../google/auth.js";
import { isBotRunning } from "../bot/bot.js";
import { listEvents } from "../google/calendar.js";
import { listTasks } from "../google/tasks.js";
import { requireSession, setSessionCookie } from "./auth.js";

export const apiRoutes = new Hono();

function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

apiRoutes.post("/login", async (c) => {
  // With no password yet there is nothing to log into: the SPA must run setup.
  if (!isPasswordConfigured()) return c.json({ setupRequired: true }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || !safeEquals(body.password, config.WEB_PASSWORD)) {
    return c.json({ error: "Wrong password" }, 401);
  }
  setSessionCookie(c);
  return c.json({ ok: true });
});

// Everything below is READ-ONLY and requires a session. /api/settings is the one
// exception: it carries its own guard so that it stays reachable during setup.
apiRoutes.use("/api/*", (c, next) =>
  c.req.path.startsWith("/api/settings") ? next() : requireSession(c, next),
);

apiRoutes.get("/api/status", (c) =>
  c.json({
    ok: isBotRunning(),
    google: isGoogleConnected(),
    timezone: config.TIMEZONE,
    now: DateTime.now().setZone(config.TIMEZONE).toISO(),
  }),
);

apiRoutes.get("/api/events", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from and to are required" }, 400);
  return c.json(await listEvents(from, to));
});

apiRoutes.get("/api/tasks", async (c) => c.json(await listTasks(true)));

apiRoutes.get("/api/notes", (c) =>
  c.json(db.select().from(schema.notes).orderBy(desc(schema.notes.updatedAt)).all()),
);

apiRoutes.get("/api/reminders", (c) =>
  c.json(
    db
      .select()
      .from(schema.reminders)
      .where(isNull(schema.reminders.firedAt))
      .orderBy(schema.reminders.fireAt)
      .all(),
  ),
);

apiRoutes.get("/api/stats", async (c) => {
  const weekOf = c.req.query("week"); // any date inside the target week
  const ref = weekOf
    ? DateTime.fromISO(weekOf, { zone: config.TIMEZONE })
    : DateTime.now().setZone(config.TIMEZONE);
  const start = ref.startOf("week");
  const end = ref.endOf("week");

  const [events, tasks] = await Promise.all([
    listEvents(start.toISO()!, end.toISO()!),
    listTasks(true),
  ]);

  const hoursByTitle = new Map<string, number>();
  for (const e of events) {
    const mins = DateTime.fromISO(e.end).diff(DateTime.fromISO(e.start), "minutes").minutes;
    if (!Number.isFinite(mins) || mins <= 0) continue;
    hoursByTitle.set(e.title, (hoursByTitle.get(e.title) ?? 0) + mins / 60);
  }
  const byActivity = [...hoursByTitle.entries()]
    .map(([title, hours]) => ({ title, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);

  const completed = tasks.filter((t) => t.completed).length;

  return c.json({
    weekStart: start.toISODate(),
    weekEnd: end.toISODate(),
    byActivity,
    totalHours: Math.round(byActivity.reduce((a, x) => a + x.hours, 0) * 10) / 10,
    tasks: { total: tasks.length, completed },
  });
});
