import { DateTime } from "luxon";
import { config } from "../config.js";
import { locale, t, type MessageKey } from "../i18n.js";
import * as calendar from "../google/calendar.js";
import type { EventSummary } from "../google/calendar.js";

/**
 * Everything about a proposed batch of changes: how it is described to the user
 * and how it is checked against the real calendar *before* the buttons are sent.
 *
 * The old flow showed one opaque paragraph written by the model and only found
 * out about stale ids while executing, which is where the "❌ Not Found" wall
 * came from.
 */

export interface PlanAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface PlanIssue {
  /** 0-based index into the action list. */
  index: number;
  level: "error" | "warning";
  text: string;
}

const CALENDAR_WRITES = new Set(["create_event", "update_event", "delete_event"]);

const VERB_ICON: Record<string, string> = {
  create_event: "➕",
  update_event: "✏️",
  delete_event: "🗑",
  create_task: "➕",
  complete_task: "☑️",
  delete_task: "🗑",
  create_note: "📝",
  update_note: "✏️",
  delete_note: "🗑",
  create_reminder: "🔔",
  delete_reminder: "🗑",
};

const dt = (iso: unknown) =>
  DateTime.fromISO(String(iso ?? ""), { zone: config.TIMEZONE }).setLocale(locale());

const hhmm = (iso: unknown) => {
  const d = dt(iso);
  return d.isValid ? d.toFormat("HH:mm") : "??:??";
};

/** Human label of an action, without the day (the day is the group header). */
export function describeAction(action: PlanAction): string {
  const { tool, args } = action;
  const icon = VERB_ICON[tool] ?? "•";
  const title = String(args.title ?? args.message ?? args.summary ?? "");

  if (CALENDAR_WRITES.has(tool)) {
    const time =
      args.start && args.end ? ` ${hhmm(args.start)}–${hhmm(args.end)}` : args.start ? ` ${hhmm(args.start)}` : "";
    // Deleting a series wipes every occurrence, not just the day shown.
    const repeat = args.series ? ` ${t("planWholeSeries")}` : args.rrule ? ` ${t("planRepeats")}` : "";
    const verb = t(
      tool === "create_event" ? "planVerbCreate" : tool === "update_event" ? "planVerbUpdate" : "planVerbDelete",
    );
    return `${icon} ${verb} ${title || t("planUntitled")}${time}${repeat}`;
  }

  if (tool === "create_reminder") return `${icon} ${t("planVerbRemind")} ${title} — ${hhmm(args.fire_at)}`;
  if (tool === "create_task") return `${icon} ${t("planVerbTask")} ${title}`;
  if (tool === "complete_task") return `${icon} ${t("planVerbComplete")} ${title}`;
  if (tool.startsWith("delete_")) return `${icon} ${t("planVerbDelete")} ${title}`;
  return `${icon} ${tool} ${title}`.trim();
}

/** Day the action belongs to, for grouping. Empty when it has no date. */
function dayKey(action: PlanAction): string {
  const iso = action.args.start ?? action.args.fire_at ?? action.args.due_date;
  const d = dt(iso);
  return d.isValid ? d.toISODate()! : "";
}

/** Deletes and moves run before creates, so a freed slot is free when reused. */
const TOOL_ORDER: Record<string, number> = { delete_event: 0, update_event: 1, create_event: 2 };

/**
 * Chronological order for both the card and the execution. Dateless actions
 * (deleting a note, a to-do) go last so the day headers stay clean.
 */
export function sortPlan(actions: PlanAction[]): PlanAction[] {
  return [...actions].sort((a, b) => {
    const da = dayKey(a);
    const dbk = dayKey(b);
    if (!da !== !dbk) return da ? -1 : 1;
    const sa = dt(a.args.start ?? a.args.fire_at ?? da);
    const sb = dt(b.args.start ?? b.args.fire_at ?? dbk);
    const ta = sa.isValid ? sa.toMillis() : Number.MAX_SAFE_INTEGER;
    const tb = sb.isValid ? sb.toMillis() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return (TOOL_ORDER[a.tool] ?? 3) - (TOOL_ORDER[b.tool] ?? 3);
  });
}

/**
 * The confirmation card: numbered actions grouped by day, plus the problems
 * found while validating. The numbers match the result lines shown afterwards.
 */
export function renderPlan(actions: PlanAction[], issues: PlanIssue[] = []): string {
  const lines: string[] = [t("planHeader", { count: actions.length })];

  let lastDay: string | null = null;
  actions.forEach((action, i) => {
    const key = dayKey(action);
    if (key !== lastDay) {
      lastDay = key;
      const d = key ? dt(key) : null;
      lines.push("", d?.isValid ? d.toFormat(t("planDateFormat")) : t("planNoDate"));
    }
    const mine = issues.filter((issue) => issue.index === i);
    const mark = mine.some((issue) => issue.level === "error") ? "❗" : mine.length ? "⚠️" : "";
    lines.push(`${i + 1}. ${describeAction(action)}${mark ? ` ${mark}` : ""}`);
    for (const issue of mine) lines.push(`     ${issue.level === "error" ? "❗" : "⚠️"} ${issue.text}`);
  });

  lines.push("", t("planFooter"));
  return lines.join("\n");
}

export type ActionOutcome =
  | "created"
  | "updated"
  | "deleted"
  | "skipped_duplicate"
  | "gone"
  | "conflict"
  | "failed";

export interface ActionResult {
  index: number;
  outcome: ActionOutcome;
  label: string;
  detail?: string;
}

const OUTCOME_ICON: Record<ActionOutcome, string> = {
  created: "✅",
  updated: "✅",
  deleted: "✅",
  skipped_duplicate: "⏭",
  gone: "⏭",
  conflict: "⚠️",
  failed: "❌",
};

/** Result block appended under the card, numbered like the plan above it. */
export function renderResults(results: ActionResult[]): string {
  const done = results.filter((r) => ["created", "updated", "deleted"].includes(r.outcome)).length;
  const skipped = results.filter((r) => ["skipped_duplicate", "gone"].includes(r.outcome)).length;
  const failed = results.filter((r) => ["failed", "conflict"].includes(r.outcome)).length;

  const lines = [t("resultsHeader")];
  for (const r of results) {
    const state = t(`outcome_${r.outcome}` as MessageKey);
    lines.push(`${OUTCOME_ICON[r.outcome]} ${r.index + 1}. ${r.label} — ${state}${r.detail ? `: ${r.detail}` : ""}`);
  }
  lines.push("", t("resultsSummary", { done, skipped, failed }));
  return lines.join("\n");
}

/** Calendar access, injectable so the validation can be tested offline. */
export interface CalendarReader {
  listEvents(fromISO: string, toISO: string): Promise<EventSummary[]>;
  getEvent(eventId: string): Promise<EventSummary | null>;
}

/** Reads each day only once no matter how many actions touch it. */
function dayReader(source: CalendarReader) {
  const cache = new Map<string, Promise<EventSummary[]>>();
  return (iso: string) => {
    const day = dt(iso).startOf("day");
    const key = day.toISODate() ?? iso;
    let hit = cache.get(key);
    if (!hit) {
      hit = source.listEvents(day.toISO()!, day.endOf("day").toISO()!);
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * Checks the plan against the real calendar. Errors mean the action cannot run
 * as written (stale id, broken times); warnings are things the user should see
 * before confirming (duplicates, overlaps).
 */
export async function validatePlan(
  actions: PlanAction[],
  source: CalendarReader = calendar,
): Promise<PlanIssue[]> {
  const issues: PlanIssue[] = [];
  const readDay = dayReader(source);
  const add = (index: number, level: PlanIssue["level"], text: string) =>
    issues.push({ index, level, text });

  // Ids this same plan removes: an overlap against them is not a real conflict.
  const removedIds = new Set(
    actions.filter((a) => a.tool === "delete_event").map((a) => String(a.args.event_id ?? "")),
  );

  const creates: { index: number; start: DateTime; end: DateTime; title: string }[] = [];

  for (const [index, action] of actions.entries()) {
    const { tool, args } = action;
    if (!CALENDAR_WRITES.has(tool)) continue;

    if (tool === "delete_event" || tool === "update_event") {
      const id = String(args.event_id ?? "");
      if (!id) {
        add(index, "error", t("issueNoId"));
        continue;
      }
      let existing: EventSummary | null = null;
      try {
        existing = await source.getEvent(id);
      } catch (err) {
        add(index, "warning", t("issueCheckFailed", { message: (err as Error).message }));
        continue;
      }
      if (!existing) {
        add(index, "error", t("issueGone"));
        continue;
      }
      // Keep the card honest even if the model mislabelled the action.
      if (args.title && calendar.normalizeTitle(String(args.title)) !== calendar.normalizeTitle(existing.title)) {
        add(index, "warning", t("issueTitleMismatch", { title: existing.title }));
      }
      // Fill the gaps from the real event so the card shows the actual name and
      // day of what is being touched, not just whatever the model typed.
      args.title ??= existing.title;
      if (tool === "delete_event") {
        args.start ??= existing.start;
        args.end ??= existing.end;
        continue;
      }
    }

    if (tool === "create_event" || (tool === "update_event" && args.start)) {
      const start = dt(args.start);
      const end = dt(args.end);
      if (!start.isValid || !end.isValid) {
        add(index, "error", t("issueBadTime"));
        continue;
      }
      if (end <= start) {
        add(index, "error", t("issueEndBeforeStart"));
        continue;
      }
      const title = String(args.title ?? "");

      // Same event twice inside the plan: the classic triplication seed.
      const twin = creates.find(
        (c) =>
          calendar.normalizeTitle(c.title) === calendar.normalizeTitle(title) &&
          c.start.toMillis() === start.toMillis(),
      );
      if (twin) add(index, "error", t("issueRepeatedInPlan", { n: twin.index + 1 }));

      const overlapInPlan = creates.find((c) => c.start < end && c.end > start && c !== twin);
      if (overlapInPlan) add(index, "warning", t("issueSelfOverlap", { n: overlapInPlan.index + 1 }));

      creates.push({ index, start, end, title });

      if (tool !== "create_event") continue;
      try {
        const sameDay = await readDay(start.toISO()!);
        const wanted = calendar.normalizeTitle(title);
        const duplicate = sameDay.find(
          (ev) =>
            calendar.normalizeTitle(ev.title) === wanted &&
            dt(ev.start).toMillis() === start.toMillis() &&
            dt(ev.end).toMillis() === end.toMillis(),
        );
        if (duplicate) {
          add(index, "warning", t("issueAlreadyExists"));
          continue;
        }
        const overlaps = sameDay.filter(
          (ev) =>
            !removedIds.has(ev.id) &&
            !removedIds.has(ev.seriesId ?? "") &&
            dt(ev.start) < end &&
            dt(ev.end) > start,
        );
        if (overlaps.length) {
          const first = overlaps[0]!;
          add(
            index,
            "warning",
            t("issueOverlap", {
              title: first.title,
              time: `${hhmm(first.start)}–${hhmm(first.end)}`,
              more: overlaps.length > 1 ? ` (+${overlaps.length - 1})` : "",
            }),
          );
        }
      } catch (err) {
        add(index, "warning", t("issueCheckFailed", { message: (err as Error).message }));
      }
    }
  }

  return issues;
}

/** Compact digest fed back to the model so it can fix its own plan. */
export function issuesForModel(actions: PlanAction[], issues: PlanIssue[]): string {
  return issues
    .map((issue) => `#${issue.index + 1} (${describeAction(actions[issue.index]!)}) → ${issue.level.toUpperCase()}: ${issue.text}`)
    .join("\n");
}

export const hasErrors = (issues: PlanIssue[]) => issues.some((i) => i.level === "error");
