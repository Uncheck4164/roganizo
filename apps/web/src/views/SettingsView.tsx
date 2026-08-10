import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleQuestionMark, ExternalLink, Eye, EyeOff, RotateCw, X } from "lucide-react";
import { category } from "../lib/colors";
import { panelStyle, type Theme } from "../lib/theme";
import { useI18n, type Lang, type TKey } from "../lib/i18n";
import {
  applySettings,
  fetchSettings,
  FIELD_BY_KEY,
  GROUP_HUE,
  GROUP_ORDER,
  helpFor,
  IS_DEMO,
  SETTINGS_FIELDS,
  SettingsValidationError,
  saveSettings,
  waitForHealth,
  type SettingsFieldDef,
  type SettingsFieldMeta,
  type SettingsGroupKey,
} from "../lib/settings";

interface Row {
  key: string;
  def: SettingsFieldDef;
  meta: SettingsFieldMeta;
}

const SCHEMA_ORDER: Record<string, number> = Object.fromEntries(
  SETTINGS_FIELDS.map((f, i) => [f.key, i]),
);

const GROUP_LABEL: Record<SettingsGroupKey, TKey> = {
  telegram: "set.group.telegram",
  model: "set.group.model",
  google: "set.group.google",
  server: "set.group.server",
  web: "set.group.web",
  preferences: "set.group.preferences",
};

function inputStyle(theme: Theme, invalid: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    boxSizing: "border-box",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "13px",
    padding: "10px 13px",
    borderRadius: "10px",
    border: `1px solid ${invalid ? "var(--warn)" : "var(--line)"}`,
    background: theme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.85)",
    color: "var(--fg)",
    outline: "none",
  };
}

const squareBtn: React.CSSProperties = {
  appearance: "none",
  border: "none",
  cursor: "pointer",
  flex: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  background: "var(--chip)",
  color: "var(--btn-fg)",
};

const pillBtn = (filled: boolean): React.CSSProperties => ({
  appearance: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "14px",
  fontWeight: 400,
  padding: filled ? "12px 24px" : "12px 22px",
  borderRadius: "999px",
  background: filled ? "var(--fg)" : "var(--chip)",
  color: filled ? "var(--bg)" : "var(--btn-fg)",
});

const codeStyle: React.CSSProperties = {
  fontSize: "11px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--faint)",
  letterSpacing: ".02em",
};

export default function SettingsView({
  theme,
  mode = "settings",
  missing = [],
}: {
  theme: Theme;
  mode?: "settings" | "setup";
  missing?: string[];
}) {
  const { t, lang, setLang } = useI18n();
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [openHelp, setOpenHelp] = useState<SettingsGroupKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [restartPending, setRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const values = settings.data?.values;
  const meta = settings.data?.meta;

  const groups = useMemo(() => {
    if (!meta) return [] as { group: SettingsGroupKey; rows: Row[] }[];
    const byGroup = new Map<SettingsGroupKey, Row[]>();
    for (const [key, m] of Object.entries(meta)) {
      const def: SettingsFieldDef = FIELD_BY_KEY[key] ?? { key, group: m.group };
      const group = m.group ?? def.group;
      const list = byGroup.get(group) ?? [];
      list.push({ key, def, meta: m });
      byGroup.set(group, list);
    }
    const known = GROUP_ORDER.filter((g) => byGroup.has(g));
    const extra = [...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g));
    return [...known, ...extra].map((group) => ({
      group,
      rows: byGroup.get(group)!.sort((a, b) => {
        const ai = SCHEMA_ORDER[a.key] ?? 999;
        const bi = SCHEMA_ORDER[b.key] ?? 999;
        return ai === bi ? a.key.localeCompare(b.key) : ai - bi;
      }),
    }));
  }, [meta]);

  const currentValue = (key: string): string => edits[key] ?? values?.[key] ?? "";
  const isDirty = (key: string): boolean =>
    edits[key] !== undefined && edits[key] !== (values?.[key] ?? "");
  const dirtyKeys = Object.keys(edits).filter(isDirty);
  const dirtyCount = dirtyKeys.length;

  const publicUrl = currentValue("PUBLIC_URL") || window.location.origin;

  const setupMode = mode === "setup";
  const passwordReady =
    !setupMode ||
    Boolean(meta?.["WEB_PASSWORD"]?.configured) ||
    currentValue("WEB_PASSWORD").length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {};
      for (const key of dirtyKeys) payload[key] = edits[key]!;
      return { result: await saveSettings(payload), sent: payload };
    },
    onMutate: () => {
      setFieldErrors({});
      setSaveError(false);
    },
    onSuccess: ({ result, sent }) => {
      const nextLang = sent["LANGUAGE"];
      if (nextLang === "es" || nextLang === "en") setLang(nextLang as Lang);
      setEdits({});
      setSavedAt(Date.now());
      if (result.restartRequired || result.setupComplete) setRestartPending(true);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      if (err instanceof SettingsValidationError) setFieldErrors(err.errors);
      else setSaveError(true);
    },
  });

  const applyAndRestart = async () => {
    setRestarting(true);
    setRestartFailed(false);
    try {
      await applySettings();
    } catch {
      // A real error response (e.g. 401) — the process did not exit.
      setRestarting(false);
      setRestartFailed(true);
      return;
    }
    const back = await waitForHealth();
    if (back) window.location.reload();
    else {
      setRestarting(false);
      setRestartFailed(true);
    }
  };

  const missingLeft = missing.filter((key) => !meta?.[key]?.configured && !isDirty(key));

  return (
    <div style={{ maxWidth: "820px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {setupMode && (
        <section className="rg-panel" style={{ ...panelStyle, padding: "28px 30px" }}>
          <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 300, letterSpacing: "-0.02em" }}>
            {t("setup.title")}
          </h2>
          <p
            style={{
              margin: "14px 0 0",
              fontSize: "14.5px",
              lineHeight: 1.65,
              color: "var(--muted)",
              textWrap: "pretty",
            }}
          >
            {t("setup.intro")}
          </p>
          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              {missingLeft.length > 0 ? t("setup.checklist") : t("setup.allSet")}
            </span>
            {missingLeft.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {missingLeft.map((key) => (
                  <code
                    key={key}
                    style={{
                      ...codeStyle,
                      color: "var(--warn)",
                      background: "var(--chip)",
                      borderRadius: "999px",
                      padding: "6px 12px",
                    }}
                  >
                    {key}
                  </code>
                ))}
              </div>
            )}
            {!passwordReady && (
              <span style={{ fontSize: "13px", color: "var(--warn)" }}>{t("setup.passwordRequired")}</span>
            )}
          </div>
        </section>
      )}

      {settings.isLoading && (
        <div style={{ fontSize: "14px", color: "var(--muted)" }}>{t("common.loading")}</div>
      )}
      {settings.isError && (
        <div style={{ fontSize: "14px", color: "var(--warn)" }}>{t("set.loadError")}</div>
      )}

      {groups.map(({ group, rows }) => {
        const help = helpFor(group, lang);
        const notConfigured = rows.filter((r) => !r.meta.configured && !r.meta.envOnly).length;
        const helpOpen = openHelp === group;
        return (
          <section key={group} className="rg-panel" style={{ ...panelStyle, padding: "26px 30px 8px" }}>
            <header style={{ display: "flex", alignItems: "center", gap: "12px", paddingBottom: "6px" }}>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "3px",
                  flex: "none",
                  background: category(group, theme, GROUP_HUE[group] ?? 200).bg,
                }}
              />
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 400, letterSpacing: "-0.01em", flex: 1 }}>
                {GROUP_LABEL[group] ? t(GROUP_LABEL[group]) : group}
              </h2>
              <span
                style={{
                  fontSize: "12px",
                  color: notConfigured > 0 ? "var(--warn)" : "var(--muted)",
                  background: "var(--chip)",
                  borderRadius: "999px",
                  padding: "5px 12px",
                  whiteSpace: "nowrap",
                }}
              >
                {notConfigured > 0 ? t("set.badge.missing", { n: notConfigured }) : t("set.badge.ok")}
              </span>
              {help && (
                <button
                  className="rg-icbtn"
                  onClick={() => setOpenHelp(helpOpen ? null : group)}
                  title={helpOpen ? t("set.helpClose") : t("set.help")}
                  aria-label={helpOpen ? t("set.helpClose") : t("set.help")}
                  aria-expanded={helpOpen}
                  style={{
                    ...squareBtn,
                    width: "32px",
                    height: "32px",
                    borderRadius: "999px",
                    background: helpOpen ? "var(--fg)" : "var(--chip)",
                    color: helpOpen ? "var(--bg)" : "var(--btn-fg)",
                  }}
                >
                  {helpOpen ? (
                    <X className="rg-ic" style={{ width: 15, height: 15 }} strokeWidth={2} />
                  ) : (
                    <CircleQuestionMark className="rg-ic" style={{ width: 16, height: 16 }} strokeWidth={2} />
                  )}
                </button>
              )}
            </header>

            {help && helpOpen && (
              <div
                style={{
                  margin: "10px 0 4px",
                  padding: "20px 22px",
                  borderRadius: "18px",
                  background: "var(--chip)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                }}
              >
                {help.steps.map((step, i) => (
                  <div
                    key={i}
                    style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", gap: "14px" }}
                  >
                    <span
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "999px",
                        background: "var(--chip-strong)",
                        color: "var(--fg)",
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                      <span style={{ fontSize: "14px", lineHeight: 1.6, textWrap: "pretty" }}>{step.text}</span>
                      {step.code && (
                        <code
                          style={{
                            ...codeStyle,
                            fontSize: "12.5px",
                            color: "var(--fg)",
                            background: theme === "dark" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.8)",
                            border: "1px solid var(--line)",
                            borderRadius: "9px",
                            padding: "8px 11px",
                            overflowX: "auto",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {step.code.replace("{publicUrl}", publicUrl.replace(/\/+$/, ""))}
                        </code>
                      )}
                      {step.image && (
                        <img
                          src={step.image}
                          alt=""
                          style={{
                            maxWidth: "100%",
                            borderRadius: "12px",
                            border: "1px solid var(--line)",
                            display: "block",
                          }}
                        />
                      )}
                      {step.links && step.links.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {step.links.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12.5px",
                                background: "var(--chip-strong)",
                                borderRadius: "999px",
                                padding: "6px 12px",
                                color: "var(--fg)",
                              }}
                            >
                              {link.label}
                              <ExternalLink style={{ width: 13, height: 13 }} strokeWidth={2} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rows.map(({ key, def, meta: m }) => {
              const secret = m.secret;
              const shown = revealed[key] === true;
              const err = fieldErrors[key];
              const readOnly = m.envOnly === true;
              const value = currentValue(key);
              const labelKey = `field.${key}.label` as TKey;
              const hintKey = `field.${key}.hint` as TKey;
              const known = FIELD_BY_KEY[key] !== undefined;
              const secretPlaceholder = m.configured
                ? m.hint
                  ? `••••${m.hint}`
                  : "••••••••"
                : t("set.secretEmpty");
              const style = inputStyle(theme, Boolean(err));

              return (
                <div
                  key={key}
                  className="rg-set-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) minmax(0,300px)",
                    gap: "10px 28px",
                    padding: "20px 0",
                    borderTop: "1px solid var(--line)",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
                    <span style={{ fontSize: "15px", lineHeight: 1.3 }}>{known ? t(labelKey) : key}</span>
                    {known && (
                      <span
                        style={{
                          fontSize: "12.5px",
                          color: "var(--muted)",
                          lineHeight: 1.55,
                          textWrap: "pretty",
                        }}
                      >
                        {t(hintKey)}
                      </span>
                    )}
                    {!secret && m.hint && (
                      <span style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.55 }}>{m.hint}</span>
                    )}
                    <code style={codeStyle}>{key}</code>
                    {readOnly && <span style={{ fontSize: "12px", color: "var(--faint)" }}>{t("set.envOnly")}</span>}
                    {err && <span style={{ fontSize: "12.5px", color: "var(--warn)" }}>{err}</span>}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    {def.kind === "select" ? (
                      <select
                        value={value}
                        disabled={readOnly}
                        onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
                        style={{ ...style, opacity: readOnly ? 0.6 : 1 }}
                      >
                        {value === "" && <option value="">—</option>}
                        {(def.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {key === "LANGUAGE"
                              ? t(opt === "es" ? "set.lang.es" : "set.lang.en")
                              : opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input
                          type={secret && !shown ? "password" : def.kind === "time" ? "time" : "text"}
                          value={value}
                          readOnly={readOnly}
                          list={def.kind === "datalist" ? `rg-dl-${key}` : undefined}
                          placeholder={secret ? secretPlaceholder : def.placeholder ?? ""}
                          spellCheck={false}
                          autoComplete={secret ? "new-password" : "off"}
                          onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
                          style={{ ...style, opacity: readOnly ? 0.6 : 1 }}
                        />
                        {def.kind === "datalist" && (
                          <datalist id={`rg-dl-${key}`}>
                            {(def.options ?? []).map((opt) => (
                              <option key={opt} value={opt} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                    {secret && def.kind !== "select" && (
                      <button
                        className="rg-icbtn"
                        onClick={() => setRevealed((s) => ({ ...s, [key]: !s[key] }))}
                        title={shown ? t("set.hide") : t("set.reveal")}
                        aria-label={shown ? t("set.hide") : t("set.reveal")}
                        style={squareBtn}
                      >
                        {shown ? (
                          <EyeOff className="rg-ic" style={{ width: 16, height: 16 }} strokeWidth={2} />
                        ) : (
                          <Eye className="rg-ic" style={{ width: 16, height: 16 }} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {(restartPending || restartFailed) && !restarting && (
        <div
          className="rg-panel"
          style={{
            ...panelStyle,
            padding: "22px 26px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "14px", flex: "1 1 240px", lineHeight: 1.5 }}>
            {restartFailed ? t("set.restartFailed") : t("set.restartRequired")}
          </span>
          <button
            onClick={() => void applyAndRestart()}
            disabled={IS_DEMO}
            title={IS_DEMO ? t("set.demoReadOnly") : undefined}
            style={{
              ...pillBtn(true),
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: IS_DEMO ? 0.45 : 1,
              cursor: IS_DEMO ? "not-allowed" : "pointer",
            }}
          >
            <RotateCw style={{ width: 15, height: 15 }} strokeWidth={2} />
            {t("set.apply")}
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          flexWrap: "wrap",
          padding: "6px 4px 0",
        }}
      >
        <button
          onClick={() => save.mutate()}
          disabled={IS_DEMO || dirtyCount === 0 || save.isPending || !passwordReady}
          title={IS_DEMO ? t("set.demoReadOnly") : undefined}
          style={{
            ...pillBtn(true),
            opacity: IS_DEMO || dirtyCount === 0 || save.isPending || !passwordReady ? 0.45 : 1,
            cursor: IS_DEMO || dirtyCount === 0 ? "not-allowed" : "pointer",
          }}
        >
          {save.isPending ? t("set.saving") : setupMode ? t("setup.finish") : t("set.save")}
        </button>
        <button
          onClick={() => {
            setEdits({});
            setFieldErrors({});
            setSaveError(false);
          }}
          disabled={dirtyCount === 0}
          style={{ ...pillBtn(false), opacity: dirtyCount === 0 ? 0.45 : 1 }}
        >
          {t("set.discard")}
        </button>
        <span
          style={{
            fontSize: "13px",
            color: saveError ? "var(--warn)" : "var(--muted)",
          }}
        >
          {saveError
            ? t("set.saveError")
            : dirtyCount === 0
              ? savedAt > 0
                ? t("set.saved")
                : IS_DEMO
                  ? t("set.demoReadOnly")
                  : t("set.clean")
              : dirtyCount === 1
                ? t("set.dirty.one")
                : t("set.dirty.many", { n: dirtyCount })}
        </span>
      </div>

      {restarting && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: theme === "dark" ? "rgba(23,27,31,0.88)" : "rgba(231,233,234,0.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <RotateCw
            style={{ width: 26, height: 26, animation: "rg-spin 1.1s linear infinite" }}
            strokeWidth={1.6}
          />
          <span style={{ fontSize: "20px", fontWeight: 300 }}>{t("set.restarting")}</span>
          <span style={{ fontSize: "14px", color: "var(--muted)", maxWidth: "340px", lineHeight: 1.6 }}>
            {t("set.restartingHint")}
          </span>
        </div>
      )}
    </div>
  );
}
