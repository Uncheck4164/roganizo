import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { fetchJson, taskDescription, taskPriority, type ApiTask } from "../lib/api";
import { chipStyle, panelStyle } from "../lib/theme";

interface ApiReminder {
  id: number;
  message: string;
  fireAt: string;
}

function fmtFireAt(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} · ${time}`;
}

type Filter = "all" | "high" | "week";

function fmtDue(due?: string): string {
  if (!due) return "sin fecha";
  const d = new Date(due);
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" }).format(d);
}

function dueSoon(due?: string): boolean {
  if (!due) return false;
  const diff = new Date(due).getTime() - Date.now();
  return diff < 7 * 24 * 3600 * 1000;
}

export default function TodosView() {
  const [filter, setFilter] = useState<Filter>("all");
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
          Todas
        </button>
        <button onClick={() => setFilter("high")} style={chipStyle(filter === "high")}>
          Prioridad alta
        </button>
        <button onClick={() => setFilter("week")} style={chipStyle(filter === "week")}>
          Esta semana
        </button>
      </div>

      <div style={{ ...panelStyle, padding: "10px 28px" }}>
        {tasks.isLoading && (
          <div style={{ padding: "24px 0", fontSize: "14px", color: "var(--muted)" }}>Cargando…</div>
        )}
        {!tasks.isLoading && pending.length === 0 && (
          <div style={{ padding: "24px 0", fontSize: "14px", color: "var(--muted)" }}>
            Nada pendiente por acá 🎉
          </div>
        )}
        {pending.map((t) => {
          const prio = taskPriority(t);
          const desc = taskDescription(t);
          return (
            <div
              key={t.id}
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
                <span style={{ fontSize: "17px", lineHeight: 1.35 }}>{t.title}</span>
                {desc && (
                  <span style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--muted)", textWrap: "pretty" }}>
                    {desc}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}>
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
                    {prio}
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
                  {fmtDue(t.due)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {(reminders.data?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)", paddingLeft: "4px" }}>
            Recordatorios programados
          </span>
          <div style={{ ...panelStyle, padding: "6px 28px" }}>
            {reminders.data!.map((r) => (
              <div
                key={r.id}
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
                  {fmtFireAt(r.fireAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)", paddingLeft: "4px" }}>Completadas</span>
          <div style={{ borderRadius: "26px", padding: "6px 28px", background: "var(--chip)" }}>
            {done.map((t) => (
              <div
                key={t.id}
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
                <span style={{ fontSize: "16px", textDecoration: "line-through" }}>{t.title}</span>
                <span style={{ fontSize: "13px" }}>{fmtDue(t.due)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
