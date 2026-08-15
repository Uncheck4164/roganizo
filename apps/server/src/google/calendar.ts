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
  /** Id of the parent series when this is an expanded instance of a recurrence. */
  seriesId?: string;
  description?: string;
}

function toSummary(e: calendar_v3.Schema$Event): EventSummary {
  return {
    id: e.id ?? "",
    title: e.summary ?? "(sin título)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    recurring: Boolean(e.recurringEventId || e.recurrence),
    seriesId: e.recurringEventId ?? undefined,
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
  /** e.g. "RRULE:FREQ=WEEKLY;BYDAY=TU" for a weekly repetition */
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

/** One event by id, or null when it does not exist (or was already cancelled). */
export async function getEvent(eventId: string): Promise<EventSummary | null> {
  try {
    const res = await cal().events.get({ calendarId: "primary", eventId });
    if (res.data.status === "cancelled") return null;
    return toSummary(res.data);
  } catch (err) {
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status === 404 || status === 410) return null;
    throw err;
  }
}

/** Titles compare case/accent/emoji-insensitively: "Cálculo 📐" == "calculo". */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * An event already in the calendar with the same title and the exact same time
 * span. This is the "created three times" case, as opposed to a mere overlap.
 */
export async function findExactDuplicate(
  title: string,
  startISO: string,
  endISO: string,
): Promise<EventSummary | null> {
  const s = DateTime.fromISO(startISO, { zone: TZ });
  const e = DateTime.fromISO(endISO, { zone: TZ });
  if (!s.isValid || !e.isValid) return null;
  const sameDay = await listEvents(s.startOf("day").toISO()!, s.endOf("day").toISO()!);
  const wanted = normalizeTitle(title);
  return (
    sameDay.find(
      (ev) =>
        normalizeTitle(ev.title) === wanted &&
        DateTime.fromISO(ev.start).setZone(TZ).toMillis() === s.toMillis() &&
        DateTime.fromISO(ev.end).setZone(TZ).toMillis() === e.toMillis(),
    ) ?? null
  );
}

export interface DuplicateGroup {
  title: string;
  start: string;
  end: string;
  /** Every copy found, ordered; the first one is the survivor. */
  copies: EventSummary[];
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  /**
   * What to delete to leave exactly one copy of each. A whole series is targeted
   * only when every one of its instances in the range is a duplicate; otherwise
   * the individual instances are, so a partially-overlapping series survives.
   */
  deletions: { id: string; title: string; when: string; kind: "series" | "instance" }[];
}

/** Finds events repeated with the exact same title and time span in a range. */
export async function findDuplicates(fromISO: string, toISO: string): Promise<DuplicateReport> {
  return groupDuplicates(await listEvents(fromISO, toISO));
}

/** Pure half of {@link findDuplicates}, over an already fetched list. */
export function groupDuplicates(events: EventSummary[]): DuplicateReport {
  const byKey = new Map<string, EventSummary[]>();
  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    const key = `${normalizeTitle(ev.title)}|${ev.start}|${ev.end}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(ev);
    else byKey.set(key, [ev]);
  }

  const groups: DuplicateGroup[] = [];
  const extras: EventSummary[] = []; // every copy beyond the first of its group
  for (const copies of byKey.values()) {
    if (copies.length < 2) continue;
    // Deterministic survivor so two runs propose the same cleanup.
    copies.sort((a, b) => (a.seriesId ?? a.id).localeCompare(b.seriesId ?? b.id));
    groups.push({ title: copies[0]!.title, start: copies[0]!.start, end: copies[0]!.end, copies });
    extras.push(...copies.slice(1));
  }

  // An instance only counts as "safe to drop the whole series" when no other
  // instance of that series in the range is unique.
  const duplicateIds = new Set(extras.map((e) => e.id));
  const seriesHasUniqueInstance = new Set<string>();
  for (const ev of events) {
    if (ev.seriesId && !duplicateIds.has(ev.id)) seriesHasUniqueInstance.add(ev.seriesId);
  }

  const deletions: DuplicateReport["deletions"] = [];
  const seen = new Set<string>();
  for (const ev of extras) {
    const asSeries = Boolean(ev.seriesId) && !seriesHasUniqueInstance.has(ev.seriesId!);
    const id = asSeries ? ev.seriesId! : ev.id;
    if (seen.has(id)) continue;
    seen.add(id);
    deletions.push({
      id,
      title: ev.title,
      when: ev.start,
      kind: asSeries ? "series" : "instance",
    });
  }
  return { groups, deletions };
}

export interface FreeSlot {
  start: string;
  end: string;
  minutes: number;
}

/** Free slots of a day between dayStart and dayEnd (local hours). */
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
