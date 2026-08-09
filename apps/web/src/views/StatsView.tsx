import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fetchJson, type ApiStats } from "../lib/api";
import { category } from "../lib/colors";
import { chipStyle, panelStyle, type Theme } from "../lib/theme";

function isoDatePlusDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtRange(startISO: string, endISO: string): string {
  const f = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });
  return `${f.format(new Date(startISO + "T12:00:00"))} – ${f.format(new Date(endISO + "T12:00:00"))}`;
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div
      style={{
        ...panelStyle,
        flex: "1 1 200px",
        minWidth: "180px",
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <span style={{ fontSize: "13px", color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: "36px", fontWeight: 200, letterSpacing: "-0.03em", lineHeight: 1 }}>
        {value}
      </span>
      {detail && <span style={{ fontSize: "13px", color: "var(--faint)" }}>{detail}</span>}
    </div>
  );
}

export default function StatsView({ theme }: { theme: Theme }) {
  // Offset de semanas respecto de la actual (0 = esta semana)
  const [weekOffset, setWeekOffset] = useState(0);
  const weekParam = isoDatePlusDays(new Date(), weekOffset * 7);

  const stats = useQuery({
    queryKey: ["stats", weekParam],
    queryFn: () => fetchJson<ApiStats>(`/api/stats?week=${weekParam}`),
  });

  const data = stats.data;
  const maxHours = Math.max(1, ...(data?.byActivity.map((a) => a.hours) ?? [1]));
  const tasksPct =
    data && data.tasks.total > 0
      ? Math.round((data.tasks.completed / data.tasks.total) * 100)
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", maxWidth: "860px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          style={{ ...chipStyle(false), display: "flex", alignItems: "center", gap: "4px" }}
          aria-label="Semana anterior"
        >
          <ChevronLeft style={{ width: 14, height: 14 }} strokeWidth={2} />
        </button>
        <button onClick={() => setWeekOffset(0)} style={chipStyle(weekOffset === 0)}>
          {data ? fmtRange(data.weekStart, data.weekEnd) : "Esta semana"}
        </button>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          style={{ ...chipStyle(false), display: "flex", alignItems: "center", gap: "4px" }}
          aria-label="Semana siguiente"
        >
          <ChevronRight style={{ width: 14, height: 14 }} strokeWidth={2} />
        </button>
      </div>

      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
        <StatTile
          label="Horas agendadas"
          value={data ? `${data.totalHours} h` : "—"}
          detail="en la semana"
        />
        <StatTile
          label="To-dos completados"
          value={tasksPct !== null ? `${tasksPct}%` : "—"}
          detail={data ? `${data.tasks.completed} de ${data.tasks.total}` : undefined}
        />
        <StatTile
          label="Actividades distintas"
          value={data ? String(data.byActivity.length) : "—"}
          detail="con tiempo asignado"
        />
      </div>

      <div style={{ ...panelStyle, padding: "26px 28px" }}>
        <div style={{ fontSize: "13px", color: "var(--muted)", paddingBottom: "20px" }}>
          Horas por actividad
        </div>
        {stats.isLoading && <div style={{ fontSize: "14px", color: "var(--muted)" }}>Cargando…</div>}
        {data && data.byActivity.length === 0 && (
          <div style={{ fontSize: "14px", color: "var(--muted)" }}>
            Sin eventos esta semana.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {data?.byActivity.map((a) => {
            const cat = category(a.title, theme);
            return (
              <div
                key={a.title}
                title={`${a.title}: ${a.hours} h`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "150px 1fr 56px",
                  gap: "14px",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.title}
                </span>
                <div
                  style={{
                    height: "14px",
                    borderRadius: "4px",
                    background: "var(--chip)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, (a.hours / maxHours) * 100)}%`,
                      height: "100%",
                      borderRadius: "4px",
                      background: cat.bg,
                      boxShadow: `inset 0 0 0 1px ${cat.stackBg}`,
                    }}
                  />
                </div>
                <span style={{ fontSize: "13px", color: "var(--muted)", textAlign: "right" }}>
                  {a.hours} h
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
