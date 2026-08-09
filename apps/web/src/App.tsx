import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, ListChecks, StickyNote, ChartNoAxesColumn, Send, Sun, Moon } from "lucide-react";
import { fetchJson, login, UnauthorizedError, type ApiStatus } from "./lib/api";
import { themeVars, tabStyle, type Theme } from "./lib/theme";
import CalendarView from "./views/CalendarView";
import TodosView from "./views/TodosView";
import NotesView from "./views/NotesView";
import StatsView from "./views/StatsView";

type Tab = "cal" | "todos" | "notes" | "stats";

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

function Login({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await login(password);
    setBusy(false);
    if (ok) onOk();
    else setError(true);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <form
        onSubmit={submit}
        style={{
          background: "var(--panel)",
          backgroundImage: "var(--sheen)",
          borderRadius: "26px",
          padding: "40px 44px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          width: "min(360px, 100%)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "30px", fontWeight: 300, letterSpacing: "-0.025em" }}>Roganizo</h1>
        <span style={{ fontSize: "14px", color: "var(--muted)" }}>Panel de solo lectura</span>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          placeholder="Contraseña"
          autoFocus
          style={{
            fontFamily: "inherit",
            fontSize: "15px",
            padding: "13px 18px",
            borderRadius: "999px",
            border: error ? "1.5px solid var(--warn)" : "1.5px solid var(--line)",
            background: "var(--chip)",
            color: "var(--fg)",
            outline: "none",
          }}
        />
        {error && <span style={{ fontSize: "13px", color: "var(--warn)" }}>Contraseña incorrecta</span>}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            fontFamily: "inherit",
            fontSize: "14px",
            fontWeight: 400,
            padding: "13px 20px",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            background: "var(--fg)",
            color: "var(--bg)",
            opacity: busy || password.length === 0 ? 0.5 : 1,
          }}
        >
          Entrar
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("cal");
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("rg-theme") as Theme) ?? "dark",
  );
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => fetchJson<ApiStatus>("/api/status"),
    retry: (count, err) => !(err instanceof UnauthorizedError) && count < 2,
    refetchInterval: 60_000,
  });

  const loggedOut = status.error instanceof UnauthorizedError;
  const botOk = status.data?.ok ?? false;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("rg-theme", next);
  };

  const iconBtn: React.CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "40px",
    background: "var(--chip)",
    border: "none",
    color: "var(--btn-fg)",
    borderRadius: "999px",
    padding: 0,
  };

  return (
    <div style={themeVars(theme)}>
      <style>{`body { background: ${theme === "dark" ? "#171b1f" : "#e7e9ea"}; }`}</style>
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "'Outfit', system-ui, sans-serif",
          fontWeight: 300,
          padding: "0 0 96px",
        }}
      >
        {loggedOut ? (
          <Login onOk={() => queryClient.invalidateQueries()} />
        ) : (
          <>
            <header
              className="rg-header"
              style={{
                maxWidth: "1120px",
                margin: "0 auto",
                padding: "52px 36px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "20px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "14px", color: "var(--muted)" }}>{greeting()}</span>
                <h1
                  className="rg-h1"
                  style={{ margin: 0, fontSize: "34px", fontWeight: 300, letterSpacing: "-0.025em", lineHeight: 1 }}
                >
                  Roganizo
                </h1>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  className="rg-icbtn"
                  title={botOk ? "Telegram conectado" : "Telegram sin conexión"}
                  style={iconBtn}
                >
                  <Send className="rg-ic rg-ic-send" strokeWidth={2} />
                  <span
                    className={botOk ? "rg-dot-ok" : ""}
                    style={{
                      position: "absolute",
                      right: "2px",
                      bottom: "2px",
                      width: "9px",
                      height: "9px",
                      borderRadius: "50%",
                      border: "2px solid var(--bg)",
                      boxSizing: "content-box",
                      background: botOk ? "var(--accent)" : "var(--warn)",
                      ["--pulse" as string]: botOk ? "var(--accent)" : "var(--warn)",
                    }}
                  />
                </div>
                <button
                  className="rg-icbtn"
                  onClick={toggleTheme}
                  title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                  aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                  style={{ ...iconBtn, appearance: "none", cursor: "pointer" }}
                >
                  {theme === "dark" ? <Sun className="rg-ic" strokeWidth={2} /> : <Moon className="rg-ic" strokeWidth={2} />}
                </button>
              </div>
            </header>

            <nav className="rg-nav" style={{ maxWidth: "1120px", margin: "0 auto", padding: "30px 36px 0" }}>
              <div
                className="rg-tabs"
                style={{
                  display: "inline-flex",
                  gap: "4px",
                  background: "var(--chip)",
                  borderRadius: "999px",
                  padding: "5px",
                }}
              >
                <button onClick={() => setTab("cal")} style={tabStyle(tab === "cal")}>
                  <Calendar style={{ width: 15, height: 15 }} strokeWidth={2} />
                  Calendario
                </button>
                <button onClick={() => setTab("todos")} style={tabStyle(tab === "todos")}>
                  <ListChecks style={{ width: 15, height: 15 }} strokeWidth={2} />
                  To-dos
                </button>
                <button onClick={() => setTab("notes")} style={tabStyle(tab === "notes")}>
                  <StickyNote style={{ width: 15, height: 15 }} strokeWidth={2} />
                  Notas
                </button>
                <button onClick={() => setTab("stats")} style={tabStyle(tab === "stats")}>
                  <ChartNoAxesColumn style={{ width: 15, height: 15 }} strokeWidth={2} />
                  Stats
                </button>
              </div>
            </nav>

            <main className="rg-main" style={{ maxWidth: "1120px", margin: "0 auto", padding: "26px 36px" }}>
              {tab === "cal" && <CalendarView theme={theme} timezone={status.data?.timezone} />}
              {tab === "todos" && <TodosView />}
              {tab === "notes" && <NotesView />}
              {tab === "stats" && <StatsView theme={theme} />}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
