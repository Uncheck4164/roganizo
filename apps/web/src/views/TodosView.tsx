import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { fetchJson, taskDescription, taskPriority, type ApiTask } from "../lib/api";
import { useI18n, type TKey } from "../lib/i18n";
import { chipStyle, panelStyle } from "../lib/theme";

interface ApiReminder {
  id: number;
  message: string;
  fireAt: string;
}

function fmtFireAt(iso: string, locale: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} · ${time}`;
}

type Filter = "all" | "high" | "week";

/** Priority keys come from the bot in Spanish; the label is translated on screen. */
const PRIO_LABEL: Record<"Alta" | "Media" | "Baja", TKey> = {
  Alta: "prio.high",
  Media: "prio.medium",
  Baja: "prio.low",
};

function dueSoon(due?: string): boolean {
  if (!due) return false;
  const diff = new Date(due).getTime() - Date.now();
  return diff < 7 * 24 * 3600 * 1000;
}

export default function TodosView() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");

  const fmtDue = (due?: string): string => {
    if (!due) return t("todos.noDue");
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(due));
  };

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => fetchJson<ApiTask[]>("/api/tasks"),
  });
  const reminders = useQuery({
    queryKey: ["reminders"],
    queryFn: () => fetchJson<ApiReminder[]>("/api/reminders"),
  });

  const all = tasks.data ?? [];
  const pending = all
    .filter((t) => !t.completed)
    .filter((t) =>
      filter === "high" ? taskPriority(t) === "Alta" : filter === "week" ? dueSoon(t.due) : true,
    );
  const done = all.filter((t) => t.completed);

  const prioColor: Record<string, string> = {
    Alta: "var(--warn)",
    Media: "var(--prio-media, #c9bd97)",
    Baja: "var(--accent)",
  };

  return (
    <div style={{ maxWidth: "860px", display: "flex", flexDirection: "column", gap: "22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={() => setFilter("all")} style={chipStyle(filter === "all")}>
          {t("todos.filter.all")}
        </button>
        <button onClick={() => setFilter("high")} style={chipStyle(filter === "high")}>
          {t("todos.filter.high")}
        </button>
        <button onClick={() => setFilter("week")} style={chipStyle(filter === "week")}>
          {t("todos.filter.week")}
        </button>
      </div>

      <div className="rg-panel" style={{ ...panelStyle, padding: "10px 28px" }}>
        {tasks.isLoading && (
          <div style={{ padding: "24px 0", fontSize: "14px", color: "var(--muted)" }}>
            {t("common.loading")}
          </div>
        )}
        {!tasks.isLoading && pending.length === 0 && (
          <div style={{ padding: "24px 0", fontSize: "14px", color: "var(--muted)" }}>
            {t("todos.empty")}
          </div>
        )}
        {pending.map((task) => {
          const prio = taskPriority(task);
          const desc = taskDescription(task);
          return (
            <div
              key={task.id}
              className="rg-todo-row"
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr auto",
                gap: "20px",
                padding: "24px 0",
                borderBottom: "1px solid var(--line)",
                alignItems: "start",
              }}
            >
              <span
                style={{
                  width: "16px",
                  height: "16px",
                  border: "1.5px solid var(--faint)",
                  borderRadius: "50%",
                  marginTop: "3px",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                <span style={{ fontSize: "17px", lineHeight: 1.35 }}>{task.title}</span>
                {desc && (
                  <span style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--muted)", textWrap: "pretty" }}>
                    {desc}
                  </span>
                )}
              </div>
              <div
                className="rg-todo-meta"
                style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}
              >
                {prio && (
                  <span style={{ display: "flex", alignItems: "center", gap: "7px", color: "var(--muted)" }}>
                    <span
                      style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: prioColor[prio],
                        display: "inline-block",
                      }}
                    />
                    {t(PRIO_LABEL[prio])}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "13px",
                    background: "var(--chip)",
                    borderRadius: "999px",
                    padding: "6px 13px",
                    color: prio === "Alta" ? "var(--warn)" : "var(--btn-fg)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDue(task.due)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {(reminders.data?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)", paddingLeft: "4px" }}>
            {t("todos.reminders")}
          </span>
          <div className="rg-panel" style={{ ...panelStyle, padding: "6px 28px" }}>
            {reminders.data!.map((r) => (
              <div
                key={r.id}
                className="rg-todo-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "18px 1fr auto",
                  gap: "20px",
                  padding: "20px 0",
                  borderBottom: "1px solid var(--line)",
                  alignItems: "center",
                }}
              >
                <Bell style={{ width: 16, height: 16, color: "var(--accent)" }} strokeWidth={2} />
                <span style={{ fontSize: "16px", lineHeight: 1.35 }}>{r.message}</span>
                <span
                  style={{
                    fontSize: "13px",
                    background: "var(--chip)",
                    borderRadius: "999px",
                    padding: "6px 13px",
                    color: "var(--btn-fg)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtFireAt(r.fireAt, locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)", paddingLeft: "4px" }}>
            {t("todos.done")}
          </span>
          <div style={{ borderRadius: "26px", padding: "6px 28px", background: "var(--chip)" }}>
            {done.map((task) => (
              <div
                key={task.id}
                className="rg-todo-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "18px 1fr auto",
                  gap: "20px",
                  padding: "20px 0",
                  borderBottom: "1px solid var(--line)",
                  alignItems: "center",
                  color: "var(--muted)",
                }}
              >
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: "var(--accent)",
                    opacity: 0.55,
                  }}
                />
                <span style={{ fontSize: "16px", textDecoration: "line-through" }}>{task.title}</span>
                <span style={{ fontSize: "13px" }}>{fmtDue(task.due)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
