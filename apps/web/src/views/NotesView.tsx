import { useQuery } from "@tanstack/react-query";
import { fetchJson, type ApiNote } from "../lib/api";
import { panelStyle } from "../lib/theme";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(iso));
}

export default function NotesView() {
  const notes = useQuery({
    queryKey: ["notes"],
    queryFn: () => fetchJson<ApiNote[]>("/api/notes"),
  });

  if (notes.isLoading)
    return <div style={{ fontSize: "14px", color: "var(--muted)" }}>Cargando…</div>;

  if (!notes.data || notes.data.length === 0)
    return (
      <div style={{ fontSize: "15px", color: "var(--muted)" }}>
        Sin notas todavía. Decile al bot "guardá una nota…" y aparece acá.
      </div>
    );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
        gap: "18px",
      }}
    >
      {notes.data.map((n) => (
        <article
          key={n.id}
          style={{
            ...panelStyle,
            padding: "28px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            minHeight: "190px",
          }}
        >
          <div style={{ fontSize: "13px", color: "var(--muted)" }}>{fmtDate(n.updatedAt)}</div>
          <h3
            style={{
              margin: 0,
              fontSize: "21px",
              fontWeight: 300,
              letterSpacing: "-0.015em",
              lineHeight: 1.25,
            }}
          >
            {n.title}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: "14.5px",
              lineHeight: 1.65,
              color: "var(--muted)",
              textWrap: "pretty",
              whiteSpace: "pre-wrap",
            }}
          >
            {n.body}
          </p>
        </article>
      ))}
    </div>
  );
}
