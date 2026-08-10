import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChartNoAxesColumn,
  Languages,
  ListChecks,
  Moon,
  Send,
  Settings,
  StickyNote,
  Sun,
} from "lucide-react";
import { fetchJson, login, UnauthorizedError, type ApiStatus } from "./lib/api";
import { fetchSetupStatus, type SetupStatus } from "./lib/settings";
import { themeVars, tabStyle, type Theme } from "./lib/theme";
import { useI18n, type TKey } from "./lib/i18n";
import CalendarView from "./views/CalendarView";
import TodosView from "./views/TodosView";
import NotesView from "./views/NotesView";
import StatsView from "./views/StatsView";
import SettingsView from "./views/SettingsView";

type Tab = "cal" | "todos" | "notes" | "stats";

function greetingKey(): TKey {
  const h = new Date().getHours();
  return h < 6 ? "greeting.night" : h < 13 ? "greeting.morning" : h < 20 ? "greeting.afternoon" : "greeting.night";
}

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

function Login({
  onOk,
  onSetupRequired,
  theme,
}: {
  onOk: () => void;
  onSetupRequired: () => void;
  theme: Theme;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(password);
    setBusy(false);
    if (res.setupRequired) onSetupRequired();
    else if (res.ok) onOk();
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
        <h1 style={{ margin: 0, lineHeight: 0 }}>
          <img
            src={import.meta.env.BASE_URL + (theme === "dark" ? "logo-lockup-dark.png" : "logo-lockup.png")}
            alt="roganizo"
            style={{ height: "34px", width: "auto", display: "block" }}
          />
        </h1>
        <span style={{ fontSize: "14px", color: "var(--muted)" }}>{t("login.subtitle")}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          placeholder={t("login.password")}
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
        {error && <span style={{ fontSize: "13px", color: "var(--warn)" }}>{t("login.error")}</span>}
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
          {t("login.submit")}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>("cal");
  const [showSettings, setShowSettings] = useState(false);
  const [loginSetup, setLoginSetup] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("rg-theme") as Theme) ?? "dark",
  );
  const queryClient = useQueryClient();

  // Setup gate: answered without a session, so it can run before the login screen.
  const setup = useQuery<SetupStatus>({
    queryKey: ["setup"],
    queryFn: fetchSetupStatus,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => fetchJson<ApiStatus>("/api/status"),
    retry: (count, err) => !(err instanceof UnauthorizedError) && count < 2,
    refetchInterval: 60_000,
  });

  // Demo data follows the language, so refetch everything when it changes (not on mount).
  const firstLang = useRef(lang);
  useEffect(() => {
    if (firstLang.current === lang) return;
    firstLang.current = lang;
    void queryClient.invalidateQueries();
  }, [lang, queryClient]);

  const setupRequired = setup.data?.setupRequired === true || loginSetup;
  const loggedOut = status.error instanceof UnauthorizedError;
  const botOk = status.data?.ok ?? false;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("rg-theme", next);
  };

  const themeLabel = theme === "dark" ? t("hdr.toLight") : t("hdr.toDark");
  const langBtn = (
    <button
      className="rg-icbtn"
      onClick={() => setLang(lang === "es" ? "en" : "es")}
      title={t("hdr.lang")}
      aria-label={t("hdr.lang")}
      style={{ ...iconBtn, appearance: "none", cursor: "pointer" }}
    >
      <Languages className="rg-ic" strokeWidth={2} />
    </button>
  );
  const themeBtn = (
    <button
      className="rg-icbtn"
      onClick={toggleTheme}
      title={themeLabel}
      aria-label={themeLabel}
      style={{ ...iconBtn, appearance: "none", cursor: "pointer" }}
    >
      {theme === "dark" ? <Sun className="rg-ic" strokeWidth={2} /> : <Moon className="rg-ic" strokeWidth={2} />}
    </button>
  );

  const shell = (children: React.ReactNode) => (
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
        {children}
      </div>
    </div>
  );

  if (setupRequired) {
    return shell(
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
          <h1 style={{ margin: 0, lineHeight: 0 }}>
            <img
              className="rg-logo"
              src={import.meta.env.BASE_URL + (theme === "dark" ? "logo-lockup-dark.png" : "logo-lockup.png")}
              alt="roganizo"
              style={{ height: "38px", width: "auto", display: "block" }}
            />
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {langBtn}
            {themeBtn}
          </div>
        </header>
        <main className="rg-main" style={{ maxWidth: "1120px", margin: "0 auto", padding: "26px 36px" }}>
          <SettingsView theme={theme} mode="setup" missing={setup.data?.missing ?? []} />
        </main>
      </>,
    );
  }

  if (loggedOut) {
    return shell(
      <Login
        theme={theme}
        onOk={() => queryClient.invalidateQueries()}
        onSetupRequired={() => setLoginSetup(true)}
      />,
    );
  }

  const goTab = (next: Tab) => {
    setTab(next);
    setShowSettings(false);
  };

  return shell(
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
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <span style={{ fontSize: "14px", color: "var(--muted)" }}>{t(greetingKey())}</span>
          <h1 style={{ margin: 0, lineHeight: 0 }}>
            <img
              className="rg-logo"
              src={import.meta.env.BASE_URL + (theme === "dark" ? "logo-lockup-dark.png" : "logo-lockup.png")}
              alt="roganizo"
              style={{ height: "38px", width: "auto", display: "block" }}
            />
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            className="rg-icbtn"
            title={botOk ? t("hdr.telegramOn") : t("hdr.telegramOff")}
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
          {langBtn}
          {themeBtn}
          <button
            className="rg-icbtn"
            onClick={() => setShowSettings((s) => !s)}
            title={showSettings ? t("hdr.settingsClose") : t("hdr.settings")}
            aria-label={showSettings ? t("hdr.settingsClose") : t("hdr.settings")}
            aria-pressed={showSettings}
            style={{
              ...iconBtn,
              appearance: "none",
              cursor: "pointer",
              background: showSettings ? "var(--fg)" : "var(--chip)",
              color: showSettings ? "var(--bg)" : "var(--btn-fg)",
              transition: "background .25s ease, color .25s ease",
            }}
          >
            <Settings className="rg-ic" strokeWidth={2} />
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
          <button onClick={() => goTab("cal")} style={tabStyle(!showSettings && tab === "cal")}>
            <Calendar style={{ width: 15, height: 15 }} strokeWidth={2} />
            {t("tab.cal")}
          </button>
          <button onClick={() => goTab("todos")} style={tabStyle(!showSettings && tab === "todos")}>
            <ListChecks style={{ width: 15, height: 15 }} strokeWidth={2} />
            {t("tab.todos")}
          </button>
          <button onClick={() => goTab("notes")} style={tabStyle(!showSettings && tab === "notes")}>
            <StickyNote style={{ width: 15, height: 15 }} strokeWidth={2} />
            {t("tab.notes")}
          </button>
          <button onClick={() => goTab("stats")} style={tabStyle(!showSettings && tab === "stats")}>
            <ChartNoAxesColumn style={{ width: 15, height: 15 }} strokeWidth={2} />
            {t("tab.stats")}
          </button>
        </div>
      </nav>

      <main className="rg-main" style={{ maxWidth: "1120px", margin: "0 auto", padding: "26px 36px" }}>
        {showSettings ? (
          <SettingsView theme={theme} />
        ) : (
          <>
            {tab === "cal" && <CalendarView theme={theme} timezone={status.data?.timezone} />}
            {tab === "todos" && <TodosView />}
            {tab === "notes" && <NotesView />}
            {tab === "stats" && <StatsView theme={theme} />}
          </>
        )}
      </main>
    </>,
  );
}
