import { google, type calendar_v3 } from "googleapis";
import { DateTime } from "luxon";
import { getAuthedClient } from "./auth.js";
import { config } from "../config.js";

const TZ = config.TIMEZONE;

function cal() {
  return google.calendar({ version: "v3", auth: getAuthedClient() });
}

export interface EventSummary {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  recurring: boolean;
  description?: string;
}

function toSummary(e: calendar_v3.Schema$Event): EventSummary {
  return {
    id: e.id ?? "",
    title: e.summary ?? "(sin título)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    recurring: Boolean(e.recurringEventId || e.recurrence),
    description: e.description ?? undefined,
  };
}

export async function listEvents(fromISO: string, toISO: string): Promise<EventSummary[]> {
  const res = await cal().events.list({
    calendarId: "primary",
    timeMin: DateTime.fromISO(fromISO, { zone: TZ }).toUTC().toISO()!,
    timeMax: DateTime.fromISO(toISO, { zone: TZ }).toUTC().toISO()!,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  return (res.data.items ?? []).map(toSummary);
}

export interface CreateEventInput {
  title: string;
  startISO: string;
  endISO: string;
  /** ej: "RRULE:FREQ=WEEKLY;BYDAY=TU" para repetición semanal */
  rrule?: string;
  description?: string;
}

export async function findConflicts(
  startISO: string,
  endISO: string,
): Promise<EventSummary[]> {
  const events = await listEvents(startISO, endISO);
  const s = DateTime.fromISO(startISO, { zone: TZ });
  const e = DateTime.fromISO(endISO, { zone: TZ });
  return events.filter((ev) => {
    const evS = DateTime.fromISO(ev.start);
    const evE = DateTime.fromISO(ev.end);
    return evS < e && evE > s;
  });
}

export async function createEvent(input: CreateEventInput): Promise<EventSummary> {
  const body: calendar_v3.Schema$Event = {
    summary: input.title,
    description: input.description,
    start: { dateTime: DateTime.fromISO(input.startISO, { zone: TZ }).toISO()!, timeZone: TZ },
    end: { dateTime: DateTime.fromISO(input.endISO, { zone: TZ }).toISO()!, timeZone: TZ },
  };
  if (input.rrule) body.recurrence = [input.rrule];
  const res = await cal().events.insert({ calendarId: "primary", requestBody: body });
  return toSummary(res.data);
}

export async function updateEvent(
  eventId: string,
  patch: Partial<CreateEventInput>,
): Promise<EventSummary> {
  const body: calendar_v3.Schema$Event = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startISO)
    body.start = { dateTime: DateTime.fromISO(patch.startISO, { zone: TZ }).toISO()!, timeZone: TZ };
  if (patch.endISO)
    body.end = { dateTime: DateTime.fromISO(patch.endISO, { zone: TZ }).toISO()!, timeZone: TZ };
  if (patch.rrule !== undefined) body.recurrence = patch.rrule ? [patch.rrule] : [];
  const res = await cal().events.patch({
    calendarId: "primary",
    eventId,
    requestBody: body,
  });
  return toSummary(res.data);
}

export async function deleteEvent(eventId: string): Promise<void> {
  await cal().events.delete({ calendarId: "primary", eventId });
}

export interface FreeSlot {
  start: string;
  end: string;
  minutes: number;
}

/** Huecos libres de un día entre dayStart y dayEnd (horas locales). */
export async function findFreeSlots(
  dateISO: string,
  minMinutes = 30,
  dayStartHour = 8,
  dayEndHour = 22,
): Promise<FreeSlot[]> {
  const day = DateTime.fromISO(dateISO, { zone: TZ }).startOf("day");
  const windowStart = day.set({ hour: dayStartHour });
  const windowEnd = day.set({ hour: dayEndHour });
  const events = await listEvents(windowStart.toISO()!, windowEnd.toISO()!);

  const busy = events
    .map((e) => ({
      s: DateTime.fromISO(e.start).setZone(TZ),
      e: DateTime.fromISO(e.end).setZone(TZ),
    }))
    .sort((a, b) => a.s.toMillis() - b.s.toMillis());

  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  for (const b of busy) {
    if (b.s > cursor) {
      const mins = b.s.diff(cursor, "minutes").minutes;
      if (mins >= minMinutes)
        slots.push({ start: cursor.toISO()!, end: b.s.toISO()!, minutes: Math.round(mins) });
    }
    if (b.e > cursor) cursor = b.e;
  }
  if (windowEnd > cursor) {
    const mins = windowEnd.diff(cursor, "minutes").minutes;
    if (mins >= minMinutes)
      slots.push({ start: cursor.toISO()!, end: windowEnd.toISO()!, minutes: Math.round(mins) });
  }
  return slots;
}
