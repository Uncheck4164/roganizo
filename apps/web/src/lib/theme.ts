// Palettes from the "Roganizo Web A" design.
export type Theme = "dark" | "light";

export const DARK: Record<string, string> = {
  "--bg": "#171b1f",
  "--panel": "#1f242a",
  "--chip": "rgba(255,255,255,0.055)",
  "--chip-strong": "rgba(255,255,255,0.11)",
  "--line": "rgba(255,255,255,0.07)",
  "--fg": "#e7e9ea",
  "--muted": "#a2abb0",
  "--faint": "#7d868b",
  "--btn-fg": "#c9d1d5",
  "--accent": "#a9c6bd",
  "--warn": "#e0a184",
  "--warn-fg": "#1b1512",
  "--sheen": "linear-gradient(160deg,rgba(255,255,255,0.055),rgba(255,255,255,0) 55%)",
  "--hero": "linear-gradient(145deg,#dfe7e6 0%,#c2d0d2 45%,#a9bcc1 100%)",
  "--hero-fg": "#1b2226",
};

export const LIGHT: Record<string, string> = {
  "--bg": "#e7e9ea",
  "--panel": "#f4f5f5",
  "--chip": "rgba(0,0,0,0.05)",
  "--chip-strong": "rgba(0,0,0,0.1)",
  "--line": "rgba(0,0,0,0.08)",
  "--fg": "#1c2126",
  "--muted": "#5d666c",
  "--faint": "#818a90",
  "--btn-fg": "#3a4248",
  "--accent": "#3f6157",
  "--warn": "#9a5335",
  "--warn-fg": "#f6efec",
  "--sheen": "linear-gradient(160deg,rgba(255,255,255,0.9),rgba(255,255,255,0) 60%)",
  "--hero": "linear-gradient(145deg,#2b333a 0%,#222a30 55%,#1a2126 100%)",
  "--hero-fg": "#eef1f1",
};

export function themeVars(theme: Theme): React.CSSProperties {
  const pal = theme === "dark" ? DARK : LIGHT;
  return {
    ...pal,
    "--fc-border-color": pal["--line"],
    "--fc-page-bg-color": "transparent",
    "--fc-neutral-bg-color": pal["--chip"],
    "--fc-today-bg-color": pal["--chip"],
    "--fc-event-border-color": "transparent",
    "--fc-event-text-color": pal["--fg"],
    "--fc-small-font-size": "12.5px",
    "--fc-list-event-hover-bg-color": pal["--chip"],
    color: pal["--fg"],
  } as React.CSSProperties;
}

export const tabStyle = (active: boolean): React.CSSProperties => ({
  appearance: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "14px",
  fontWeight: 400,
  padding: "10px 20px",
  borderRadius: "999px",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  background: active ? "var(--fg)" : "transparent",
  color: active ? "var(--bg)" : "var(--btn-fg)",
  transition: "background .25s ease, color .25s ease",
});

export const chipStyle = (active: boolean): React.CSSProperties => ({
  appearance: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "13px",
  fontWeight: 400,
  padding: "9px 18px",
  borderRadius: "999px",
  border: "none",
  background: active ? "var(--fg)" : "var(--chip)",
  color: active ? "var(--bg)" : "var(--btn-fg)",
});

export const panelStyle: React.CSSProperties = {
  background: "var(--panel)",
  backgroundImage: "var(--sheen)",
  borderRadius: "26px",
};
