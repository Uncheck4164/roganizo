import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import { fetchJson, type ApiEvent } from "../lib/api";
import { category } from "../lib/colors";
import { useI18n } from "../lib/i18n";
import { chipStyle, panelStyle, type Theme } from "../lib/theme";

type EvFilter = "all" | "once" | "weekly";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// As in the original design: if you are awake outside 07-22 the grid stretches
// to include the current hour (so the "now" line is always visible).
const H0 = new Date().getHours();
const DAY_START_HOUR = Math.min(7, Math.max(0, H0));
const DAY_END_HOUR = Math.max(22, Math.min(24, H0 + 2));

interface Popover {
  title: string;
  when: string;
  recurring: boolean;
  left: number;
  top: number;
}

function todayRange(): { from: string; to: string } {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
  return { from, to };
}

export default function CalendarView({
  theme,
  timezone,
}: {
  theme: Theme;
  timezone?: string;
}) {
  const { t, lang, locale } = useI18n();
  const [filter, setFilter] = useState<EvFilter>("all");
  const [now, setNow] = useState(new Date());
  const [popover, setPopover] = useState<Popover | null>(null);
  // Mobile: Day view and a compact toolbar by default; desktop: full Week.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  const wrapRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<FullCalendar>(null);

  useEffect(() => {
    // Crossing the breakpoint remounts FullCalendar (via key) with the view and
    // toolbars that match the new width.
    const onResize = () => {
      const n = window.innerWidth < 760;
      setNarrow((prev) => {
        if (n !== prev) setPopover(null);
        return n;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Memoised events function: if its identity changed on every render,
  // FullCalendar would reload the calendar every 30s (the clock tick).
  const fetchEvents = useCallback(
    async (
      info: { startStr: string; endStr: string },
      success: (events: EventInput[]) => void,
      failure: (error: Error) => void,
    ) => {
      try {
        const evs = await fetchJson<ApiEvent[]>(
          `/api/events?from=${encodeURIComponent(info.startStr)}&to=${encodeURIComponent(info.endStr)}`,
        );
        const filtered = evs.filter((e) =>
          filter === "once" ? !e.recurring : filter === "weekly" ? e.recurring : true,
        );
        success(
          filtered.map(
            (e): EventInput => ({
              id: e.id,
              title: e.title,
              start: e.start,
              end: e.end,
              extendedProps: { recurring: e.recurring },
            }),
          ),
        );
      } catch (err) {
        failure(err as Error);
      }
    },
    [filter],
  );

  // The theme lives outside FullCalendar: re-render events to repaint the colours.
  useEffect(() => {
    calRef.current?.getApi().refetchEvents();
  }, [theme]);

  const range = todayRange();
  const todayEvents = useQuery({
    queryKey: ["events-today"],
    queryFn: () => fetchJson<ApiEvent[]>(`/api/events?from=${range.from}&to=${range.to}`),
  });

  // FullCalendar does not go through TanStack Query: it refreshes on its own.
  useEffect(() => {
    const t = setInterval(() => calRef.current?.getApi().refetchEvents(), 60_000);
    return () => clearInterval(t);
  }, []);

  const agenda = useMemo(
    () =>
      (todayEvents.data ?? [])
        .map((e) => ({ ...e, s: new Date(e.start), e: new Date(e.end) }))
        .sort((a, b) => a.s.getTime() - b.s.getTime()),
    [todayEvents.data],
  );
  const current = agenda.find((e) => e.s <= now && now < e.e);
  const upcoming = agenda.filter((e) => e.s > now).slice(0, 3);

  let pct = 0;
  let remaining = "";
  if (current) {
    pct = Math.max(
      3,
      Math.min(
        100,
        Math.round(((now.getTime() - current.s.getTime()) / (current.e.getTime() - current.s.getTime())) * 100),
      ),
    );
    remaining = t("cal.remaining", {
      n: Math.max(1, Math.round((current.e.getTime() - now.getTime()) / 60000)),
    });
  }

  const swatch = (title: string, size = 12): React.CSSProperties => ({
    width: size,
    height: size,
    borderRadius: "4px",
    flex: "none",
    background: category(title, theme).bg,
  });

  // Slot label the "now" line covers (hidden so the two do not overlap).
  const hiddenLabelRef = useRef<HTMLElement | null>(null);

  // "Now" line over the time grid (ported from the design).
  useEffect(() => {
    const sync = () => {
      const root = wrapRef.current;
      if (!root) return;
      const body = root.querySelector(".fc-timegrid-body");
      let line = root.querySelector<HTMLDivElement>(".rg-nowline");
      const cur = now.getHours() * 60 + now.getMinutes();
      const dayStart = DAY_START_HOUR * 60;
      const dayEnd = DAY_END_HOUR * 60;
      if (!body || cur < dayStart || cur > dayEnd) {
        line?.remove();
        return;
      }
      const slots =
        body.querySelector(".fc-timegrid-slots table") ?? body.querySelector(".fc-timegrid-slots");
      if (!slots) return;
      const height = slots.getBoundingClientRect().height;
      if (!height) return;
      if (!line) {
        line = document.createElement("div");
        line.className = "rg-nowline";
        const chip = document.createElement("span");
        chip.className = "rg-nowchip";
        line.appendChild(chip);
        body.appendChild(line);
      } else if (line.parentElement !== body) {
        body.appendChild(line);
      }
      line.querySelector(".rg-nowchip")!.textContent = hhmm(now);
      line.style.top = `${Math.round(((cur - dayStart) / (dayEnd - dayStart)) * height)}px`;

      // Hide the slot label closest to the line (from the updated design).
      if (hiddenLabelRef.current) {
        hiddenLabelRef.current.style.visibility = "";
        hiddenLabelRef.current = null;
      }
      const lineY = line.getBoundingClientRect().top;
      let best: HTMLElement | null = null;
      let bestD = Infinity;
      root.querySelectorAll<HTMLElement>(".fc-timegrid-slot-label-cushion").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - lineY);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      });
      if (best && bestD < 16) {
        (best as HTMLElement).style.visibility = "hidden";
        hiddenLabelRef.current = best;
      }
    };
    sync();
    const t = setInterval(sync, 30_000);
    window.addEventListener("resize", sync);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", sync);
    };
  }, [now, theme]);

  const eventClick = (arg: EventClickArg) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const r = arg.el.getBoundingClientRect();
    const left = Math.max(4, Math.min(r.left - wr.left, Math.max(4, wrap.clientWidth - 296)));
    let top = r.bottom - wr.top + 8;
    if (top > wrap.clientHeight - 150) top = Math.max(4, r.top - wr.top - 148);
    const start = arg.event.start;
    const end = arg.event.end;
    let when = start
      ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(start) +
        (end ? ` · ${hhmm(start)} – ${hhmm(end)}` : "")
      : "";
    when = when.charAt(0).toUpperCase() + when.slice(1);
    setPopover({
      title: arg.event.title,
      when,
      recurring: Boolean(arg.event.extendedProps.recurring),
      left,
      top,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "stretch" }}>
        <div
          className="rg-hero"
          style={{
            flex: "2 1 380px",
            minWidth: "300px",
            borderRadius: "26px",
            padding: "30px 32px 34px",
            backgroundImage: "var(--hero)",
            color: "var(--hero-fg)",
            boxShadow:
              theme === "dark" ? "0 18px 50px rgba(0,0,0,0.35)" : "0 18px 50px rgba(28,33,38,0.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <span style={{ fontSize: "13px", opacity: 0.65 }}>{t("cal.now")}</span>
            <span style={{ fontSize: "13px", opacity: 0.65 }}>
              {hhmm(now)} · {timezone?.split("/")[1]?.replace("_", " ") ?? "Santiago"}
            </span>
          </div>
          {current ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "26px" }}>
              <div
                className="rg-hero-title"
                style={{ fontSize: "40px", fontWeight: 200, letterSpacing: "-0.03em", lineHeight: 1.05 }}
              >
                {current.title}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.7 }}>
                {hhmm(current.s)} – {hhmm(current.e)} · {remaining}
              </div>
              <div
                style={{
                  height: "3px",
                  borderRadius: "3px",
                  background: theme === "dark" ? "rgba(27,34,38,0.18)" : "rgba(238,241,241,0.22)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: "3px",
                    background: "currentColor",
                    opacity: 0.75,
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              className="rg-hero-title"
              style={{ marginTop: "26px", fontSize: "34px", fontWeight: 200, letterSpacing: "-0.03em", opacity: 0.75 }}
            >
              {t("cal.free")}
            </div>
          )}
        </div>

        <div
          className="rg-next"
          style={{
            ...panelStyle,
            flex: "1 1 280px",
            minWidth: "260px",
            padding: "26px 28px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>{t("cal.next")}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {upcoming.length === 0 && (
              <span style={{ fontSize: "14px", color: "var(--faint)" }}>{t("cal.nothingElse")}</span>
            )}
            {upcoming.map((e) => {
              const mins = Math.round((e.s.getTime() - now.getTime()) / 60000);
              return (
                <div key={e.id + e.start} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={swatch(e.title)} />
                  <span style={{ fontSize: "14px", color: "var(--muted)", minWidth: "44px" }}>{hhmm(e.s)}</span>
                  <span style={{ fontSize: "17px", flex: 1, fontWeight: 300 }}>{e.title}</span>
                  <span style={{ fontSize: "13px", color: "var(--faint)" }}>
                    {mins < 60
                      ? t("cal.inMin", { n: mins })
                      : t("cal.inHours", { n: Math.round(mins / 60) })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rg-panel" style={{ ...panelStyle, padding: "26px 28px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingBottom: "18px" }}>
          <button onClick={() => setFilter("all")} style={chipStyle(filter === "all")}>
            {t("cal.filter.all")}
          </button>
          <button onClick={() => setFilter("once")} style={chipStyle(filter === "once")}>
            {t("cal.filter.once")}
          </button>
          <button onClick={() => setFilter("weekly")} style={chipStyle(filter === "weekly")}>
            {t("cal.filter.weekly")}
          </button>
        </div>
        <div ref={wrapRef} className="rg-cal" style={{ position: "relative", minHeight: 620 }} onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".fc-event") && !(e.target as HTMLElement).closest("[data-rg-pop]"))
            setPopover(null);
        }}>
          <FullCalendar
            key={`${narrow ? "m" : "d"}-${lang}`}
            ref={calRef}
            plugins={[timeGridPlugin, dayGridPlugin, listPlugin]}
            initialView={narrow ? "timeGridDay" : "timeGridWeek"}
            locale={lang === "es" ? esLocale : "en"}
            firstDay={1}
            nowIndicator={false}
            allDaySlot={false}
            displayEventTime={false}
            slotMinTime={`${pad(DAY_START_HOUR)}:00:00`}
            slotMaxTime={`${pad(DAY_END_HOUR)}:00:00`}
            slotDuration="01:00:00"
            slotEventOverlap={false}
            eventMinHeight={20}
            eventShortHeight={60}
            expandRows
            height="auto"
            dayMaxEvents
            headerToolbar={
              narrow
                ? { left: "prev,next", center: "title", right: "today" }
                : {
                    left: "prev,next today",
                    center: "title",
                    right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek",
                  }
            }
            footerToolbar={
              narrow ? { center: "timeGridDay,timeGridWeek,dayGridMonth,listWeek" } : false
            }
            buttonText={{
              today: t("cal.btn.today"),
              month: t("cal.btn.month"),
              week: t("cal.btn.week"),
              day: t("cal.btn.day"),
              list: t("cal.btn.list"),
            }}
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            events={fetchEvents}
            eventDidMount={(arg) => {
              const cat = category(arg.event.title, theme);
              const dot = arg.el.querySelector<HTMLElement>(".fc-list-event-dot");
              if (dot) {
                dot.style.borderColor = cat.edge;
                return;
              }
              arg.el.style.background = cat.bg;
              arg.el.style.backgroundImage = "none";
              arg.el.style.color = cat.fg;
              arg.el.style.setProperty("--rg-stack-bg", cat.stackBg);
            }}
            eventContent={(arg) => {
              if (arg.view.type.startsWith("list")) {
                return (
                  <span style={{ color: "var(--fg)" }}>
                    {arg.event.title}
                    {arg.event.extendedProps.recurring ? `  ·  ${t("cal.everyWeek")}` : ""}
                  </span>
                );
              }
              const hasHead =
                (arg.event.start && arg.event.end) || arg.event.extendedProps.recurring;
              return (
                <div className="rg-ev" title={arg.event.title}>
                  <span className="rg-ev-t">{arg.event.title}</span>
                  {hasHead && (
                    <div className="rg-ev-head">
                      {arg.event.start && arg.event.end && (
                        <span className="rg-ev-time">
                          {hhmm(arg.event.start)} – {hhmm(arg.event.end)}
                        </span>
                      )}
                      {arg.event.extendedProps.recurring && (
                        <span className="rg-stack" title={t("cal.recurring")}>
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            }}
            eventClick={eventClick}
            datesSet={() => setPopover(null)}
          />
          {popover && (
            <div
              className="rg-pop"
              data-rg-pop="1"
              style={{
                position: "absolute",
                zIndex: 41,
                left: popover.left,
                top: popover.top,
                width: "270px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                boxShadow:
                  theme === "dark" ? "0 22px 60px rgba(0,0,0,0.5)" : "0 22px 60px rgba(28,33,38,0.25)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={swatch(popover.title, 14)} />
                <span style={{ fontSize: "17px", fontWeight: 400, flex: 1, lineHeight: 1.3 }}>{popover.title}</span>
                <button
                  onClick={() => setPopover(null)}
                  style={{
                    appearance: "none",
                    border: "none",
                    cursor: "pointer",
                    background: "var(--chip)",
                    color: "var(--muted)",
                    borderRadius: "999px",
                    width: "26px",
                    height: "26px",
                    fontSize: "14px",
                    lineHeight: 1,
                    flex: "none",
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ fontSize: "14px", color: "var(--muted)" }}>{popover.when}</div>
              <div style={{ fontSize: "13px", color: "var(--faint)" }}>
                {popover.recurring ? t("cal.recurring") : t("cal.once")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
