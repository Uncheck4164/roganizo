import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleQuestionMark,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  RotateCw,
  X,
} from "lucide-react";
import { category } from "../lib/colors";
import { panelStyle, type Theme } from "../lib/theme";
import { useI18n, type Lang, type TKey } from "../lib/i18n";
import {
  activeProvider,
  apiKeyFor,
  applySettings,
  checkGoogle,
  checkLlm,
  checkTelegram,
  fetchGoogleSetup,
  fetchSettings,
  fetchTelegramLinkStatus,
  FIELD_BY_KEY,
  GROUP_HUE,
  GROUP_ORDER,
  helpFor,
  IS_DEMO,
  saveSettings,
  SETTINGS_FIELDS,
  SettingsValidationError,
  startTelegramLink,
  waitForHealth,
  type GoogleCheckResult,
  type LlmCheckResult,
  type SettingsFieldDef,
  type SettingsFieldMeta,
  type SettingsGroupKey,
  type TelegramCheckResult,
  type TelegramLinkResult,
} from "../lib/settings";

interface Row {
  key: string;
  def: SettingsFieldDef;
  meta: SettingsFieldMeta;
}
type Operation =
  | "saving"
  | "applying"
  | "telegram-check"
  | "telegram-link"
  | "llm-check"
  | "google-check"
  | "google-connect"
  | null;

const SCHEMA_ORDER: Record<string, number> = Object.fromEntries(
  SETTINGS_FIELDS.map((field, index) => [field.key, index]),
);
const GROUP_LABEL: Record<SettingsGroupKey, TKey> = {
  telegram: "set.group.telegram",
  model: "set.group.model",
  google: "set.group.google",
  server: "set.group.server",
  web: "set.group.web",
  preferences: "set.group.preferences",
};
const STEP_LABELS: TKey[] = [
  "setup.step.telegram",
  "setup.step.llm",
  "setup.step.google",
  "setup.step.access",
];
const MODEL_ADVANCED = [
  "OPENAI_MODEL",
  "OPENAI_MODEL_STRONG",
  "OPENAI_REASONING_EFFORT",
  "OPENROUTER_MODEL",
  "OPENROUTER_MODEL_STRONG",
  "OPENROUTER_QUALITY_FLOOR",
  "OPENROUTER_MAX_PRICE",
  "OPENROUTER_PROVIDER_ORDER",
  "OPENROUTER_SORT",
];

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

function advancedInSettings(group: SettingsGroupKey, key: string): boolean {
  if (group === "telegram") return key !== "TELEGRAM_BOT_TOKEN";
  if (group === "model") return !["LLM_PROVIDER", "OPENAI_API_KEY", "OPENROUTER_API_KEY"].includes(key);
  if (group === "server") return key === "PORT" || key === "DATABASE_PATH";
  if (group === "preferences") return key === "BRIEFING_TIME";
  return false;
}

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
  const setupMode = mode === "setup";
  const [step, setStep] = useState(() => (new URLSearchParams(window.location.search).has("google") ? 2 : 0));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const [openHelp, setOpenHelp] = useState<SettingsGroupKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const [operation, setOperation] = useState<Operation>(null);
  const [restartFailed, setRestartFailed] = useState(false);
  const [telegramResult, setTelegramResult] = useState<TelegramCheckResult | null>(null);
  const [linkResult, setLinkResult] = useState<TelegramLinkResult | null>(null);
  const [llmResult, setLlmResult] = useState<LlmCheckResult | null>(null);
  const [googleResult, setGoogleResult] = useState<GoogleCheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<{ ok: boolean; message?: string } | null>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const google = useQuery({
    queryKey: ["setup-google"],
    queryFn: fetchGoogleSetup,
    enabled: settings.isSuccess,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const linkStarted = linkResult?.ok === true;
  const linkStatus = useQuery({
    queryKey: ["setup-telegram-link"],
    queryFn: fetchTelegramLinkStatus,
    enabled: linkStarted,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || status === "waiting" ? 2_000 : false;
    },
  });
  const values = settings.data?.values;
  const meta = settings.data?.meta;
  const currentValue = (key: string): string => edits[key] ?? values?.[key] ?? "";
  const isDirty = (key: string): boolean => edits[key] !== undefined && edits[key] !== (values?.[key] ?? "");
  const dirtyKeys = Object.keys(edits).filter(isDirty);
  const provider = activeProvider(currentValue("LLM_PROVIDER"));
  const busy = operation !== null;

  const groups = useMemo(() => {
    if (!meta) return [] as { group: SettingsGroupKey; rows: Row[] }[];
    const byGroup = new Map<SettingsGroupKey, Row[]>();
    for (const [key, fieldMeta] of Object.entries(meta)) {
      const def: SettingsFieldDef = FIELD_BY_KEY[key] ?? { key, group: fieldMeta.group };
      const group = fieldMeta.group ?? def.group;
      const rows = byGroup.get(group) ?? [];
      rows.push({ key, def, meta: fieldMeta });
      byGroup.set(group, rows);
    }
    return GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
      group,
      rows: byGroup.get(group)!.sort((a, b) => (SCHEMA_ORDER[a.key] ?? 999) - (SCHEMA_ORDER[b.key] ?? 999)),
    }));
  }, [meta]);

  useEffect(() => {
    if (!values || !meta) return;
    const detected: Record<string, string> = {
      PUBLIC_URL: window.location.origin,
      TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
      LANGUAGE: navigator.language.toLowerCase().startsWith("en") ? "en" : "es",
    };
    // During setup the detected public URL is saved right away (effect below):
    // the Google step shows the redirect URI to copy, and an unsaved suggestion
    // would leave the default localhost one on screen to be copied by mistake.
    if (setupMode) delete detected.PUBLIC_URL;
    setEdits((current) => {
      const next = { ...current };
      let changed = false;
      for (const [key, value] of Object.entries(detected)) {
        if (meta[key]?.source !== "default" || current[key] !== undefined || !value) continue;
        if (value !== values[key]) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [values, meta, setupMode]);

  useEffect(() => {
    if (!setupMode || IS_DEMO || meta?.PUBLIC_URL?.source !== "default") return;
    const origin = window.location.origin;
    if (values?.PUBLIC_URL === origin) return;
    void saveSettings({ PUBLIC_URL: origin })
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ["settings"] }),
          queryClient.invalidateQueries({ queryKey: ["setup-google"] }),
        ]),
      )
      .catch(() => {});
  }, [setupMode, meta, values, queryClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("google");
    if (state !== "connected" && state !== "error") return;
    setOauthNotice({ ok: state === "connected", message: params.get("message") ?? undefined });
    params.delete("google");
    params.delete("message");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    void queryClient.invalidateQueries({ queryKey: ["setup-google"] });
  }, [queryClient]);

  useEffect(() => {
    if (linkStatus.data?.status !== "linked") return;
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
    void queryClient.invalidateQueries({ queryKey: ["setup-status"] });
  }, [linkStatus.data?.status, queryClient]);

  const visibleKey = (key: string): boolean => {
    const def = FIELD_BY_KEY[key];
    return !def?.provider || def.provider === provider;
  };
  const modelKeys = (): string[] => [
    "LLM_PROVIDER",
    apiKeyFor(provider),
    ...MODEL_ADVANCED.filter(visibleKey),
  ];
  const refreshConfiguration = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
      queryClient.invalidateQueries({ queryKey: ["setup-status"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["setup-google"] }),
    ]);
  };

  const persist = async (keys: string[]): Promise<boolean> => {
    const sent: Record<string, string> = {};
    for (const key of [...new Set(keys)]) if (isDirty(key)) sent[key] = edits[key]!;
    if (Object.keys(sent).length === 0) return true;
    setFieldErrors({});
    setSaveError("");
    setRestartFailed(false);
    setOperation("saving");
    try {
      const result = await saveSettings(sent);
      const nextLang = sent.LANGUAGE;
      if (nextLang === "es" || nextLang === "en") setLang(nextLang as Lang);
      setEdits((current) => {
        const next = { ...current };
        for (const key of Object.keys(sent)) delete next[key];
        return next;
      });
      setSavedAt(Date.now());
      if (result.restartRequired) {
        setOperation("applying");
        await applySettings();
        if (!(await waitForHealth())) {
          setRestartFailed(true);
          setSaveError(t("set.restartFailed"));
          return false;
        }
      }
      await refreshConfiguration();
      return true;
    } catch (error) {
      if (error instanceof SettingsValidationError) setFieldErrors(error.errors);
      else setSaveError(t("set.saveError"));
      return false;
    } finally {
      setOperation(null);
    }
  };

  const testTelegram = async () => {
    if (!(await persist(["TELEGRAM_BOT_TOKEN"]))) return;
    setOperation("telegram-check");
    setTelegramResult(null);
    try {
      setTelegramResult(await checkTelegram());
    } catch {
      setTelegramResult({ ok: false, error: t("setup.testRequestFailed") });
    } finally {
      setOperation(null);
    }
  };
  const beginTelegramLink = async () => {
    if (!(await persist(["TELEGRAM_BOT_TOKEN"]))) return;
    setOperation("telegram-link");
    try {
      const result = await startTelegramLink();
      setLinkResult(result);
      if (result.ok) {
        setTelegramResult({ ok: true, username: result.username, name: result.username });
        await linkStatus.refetch();
      }
    } catch {
      setLinkResult({ ok: false, error: t("setup.testRequestFailed") });
    } finally {
      setOperation(null);
    }
  };
  const testLlm = async () => {
    if (!(await persist(modelKeys()))) return;
    setOperation("llm-check");
    setLlmResult(null);
    try {
      setLlmResult(await checkLlm());
    } catch {
      setLlmResult({
        ok: false,
        model: currentValue(provider === "openai" ? "OPENAI_MODEL" : "OPENROUTER_MODEL"),
        error: t("setup.testRequestFailed"),
      });
    } finally {
      setOperation(null);
    }
  };
  const saveGoogleFields = async (): Promise<boolean> => {
    const saved = await persist(["PUBLIC_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    if (saved) await queryClient.refetchQueries({ queryKey: ["setup-google"] });
    return saved;
  };
  const connectGoogle = async () => {
    setOperation("google-connect");
    const saved = await saveGoogleFields();
    if (!saved) {
      setOperation(null);
      return;
    }
    try {
      const info = await fetchGoogleSetup();
      if (!info.clientConfigured) {
        setSaveError(t("setup.google.credentialsMissing"));
        setOperation(null);
        return;
      }
      window.location.assign("/oauth/login?return=setup");
    } catch {
      setSaveError(t("setup.testRequestFailed"));
      setOperation(null);
    }
  };
  const testGoogleConnection = async () => {
    if (!(await saveGoogleFields())) return;
    setOperation("google-check");
    setGoogleResult(null);
    try {
      setGoogleResult(await checkGoogle());
    } catch {
      setGoogleResult({
        ok: false,
        calendar: t("setup.testRequestFailed"),
        tasks: t("setup.testRequestFailed"),
      });
    } finally {
      setOperation(null);
    }
  };
  const copyRedirect = async () => {
    const uri = google.data?.redirectUri;
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const renderField = (key: string, showKey = !setupMode) => {
    const fieldMeta = meta?.[key];
    if (!fieldMeta || !visibleKey(key)) return null;
    const def = FIELD_BY_KEY[key] ?? { key, group: fieldMeta.group };
    const secret = fieldMeta.secret;
    const shown = revealed[key] === true;
    const error = fieldErrors[key];
    const readOnly = fieldMeta.envOnly === true;
    const value = currentValue(key);
    const known = FIELD_BY_KEY[key] !== undefined;
    const labelKey = `field.${key}.label` as TKey;
    const hintKey = `field.${key}.hint` as TKey;
    const secretPlaceholder = fieldMeta.configured
      ? fieldMeta.hint
        ? `••••${fieldMeta.hint}`
        : "••••••••"
      : t("set.secretEmpty");
    const style = inputStyle(theme, Boolean(error));
    return (
      <div
        key={key}
        className="rg-set-row"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,300px)",
          gap: "10px 28px",
          padding: "18px 0",
          borderTop: "1px solid var(--line)",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 15, lineHeight: 1.3 }}>{known ? t(labelKey) : key}</span>
          {known && (
            <span style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>{t(hintKey)}</span>
          )}
          {showKey && <code style={codeStyle}>{key}</code>}
          {readOnly && <span style={{ fontSize: 12, color: "var(--faint)" }}>{t("set.envOnly")}</span>}
          {error && <span style={{ fontSize: 12.5, color: "var(--warn)" }}>{error}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {def.kind === "select" ? (
            <select
              value={value}
              disabled={readOnly || busy}
              onChange={(event) => setEdits((current) => ({ ...current, [key]: event.target.value }))}
              style={{ ...style, opacity: readOnly ? 0.6 : 1 }}
            >
              {value === "" && <option value="">—</option>}
              {(def.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {key === "LANGUAGE"
                    ? t(option === "es" ? "set.lang.es" : "set.lang.en")
                    : key === "LLM_PROVIDER"
                      ? option === "openai"
                        ? "OpenAI"
                        : "OpenRouter"
                      : option}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type={secret && !shown ? "password" : def.kind === "time" ? "time" : "text"}
                value={value}
                readOnly={readOnly}
                disabled={busy && !readOnly}
                list={def.kind === "datalist" ? `rg-dl-${key}` : undefined}
                placeholder={secret ? secretPlaceholder : (def.placeholder ?? "")}
                spellCheck={false}
                autoComplete={secret ? "new-password" : "off"}
                onChange={(event) => setEdits((current) => ({ ...current, [key]: event.target.value }))}
                style={{ ...style, opacity: readOnly ? 0.6 : 1 }}
              />
              {def.kind === "datalist" && (
                <datalist id={`rg-dl-${key}`}>
                  {(def.options ?? []).map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}
            </>
          )}
          {secret && def.kind !== "select" && (
            <button
              className="rg-icbtn"
              type="button"
              onClick={() => setRevealed((current) => ({ ...current, [key]: !current[key] }))}
              title={shown ? t("set.hide") : t("set.reveal")}
              aria-label={shown ? t("set.hide") : t("set.reveal")}
              style={squareBtn}
            >
              {shown ? (
                <EyeOff style={{ width: 16, height: 16 }} />
              ) : (
                <Eye style={{ width: 16, height: 16 }} />
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderHelp = (group: SettingsGroupKey) => {
    const help = helpFor(group, lang);
    if (!help || openHelp !== group) return null;
    return (
      <div
        style={{
          margin: "10px 0 14px",
          padding: "20px 22px",
          borderRadius: 18,
          background: "var(--chip)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {help.steps.map((item, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", gap: 14 }}>
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                background: "var(--chip-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
              }}
            >
              {index + 1}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 14, lineHeight: 1.6 }}>{item.text}</span>
              {item.code && (
                <code style={{ ...codeStyle, fontSize: 12.5, color: "var(--fg)" }}>{item.code}</code>
              )}
              {item.links && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {item.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12.5,
                        background: "var(--chip-strong)",
                        borderRadius: 999,
                        padding: "6px 12px",
                        color: "var(--fg)",
                      }}
                    >
                      {link.label}
                      <ExternalLink style={{ width: 13, height: 13 }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };
  const helpButton = (group: SettingsGroupKey) =>
    helpFor(group, lang) ? (
      <button
        className="rg-icbtn"
        type="button"
        onClick={() => setOpenHelp(openHelp === group ? null : group)}
        title={openHelp === group ? t("set.helpClose") : t("set.help")}
        aria-label={openHelp === group ? t("set.helpClose") : t("set.help")}
        style={{ ...squareBtn, width: 32, height: 32, borderRadius: 999 }}
      >
        {openHelp === group ? (
          <X style={{ width: 15, height: 15 }} />
        ) : (
          <CircleQuestionMark style={{ width: 16, height: 16 }} />
        )}
      </button>
    ) : null;
  const renderAdvanced = (id: string, keys: string[]) => {
    const visible = keys.filter((key) => meta?.[key] && visibleKey(key));
    if (!visible.length) return null;
    const open = advancedOpen[id] === true;
    return (
      <div style={{ borderTop: "1px solid var(--line)" }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((current) => ({ ...current, [id]: !current[id] }))}
          aria-expanded={open}
          style={{
            width: "100%",
            border: 0,
            background: "transparent",
            color: "var(--muted)",
            padding: "16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13.5,
          }}
        >
          {t("set.advanced")}
          <ChevronDown
            style={{
              width: 16,
              height: 16,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .2s",
            }}
          />
        </button>
        {open && visible.map((key) => renderField(key))}
      </div>
    );
  };
  const resultBox = (ok: boolean, children: React.ReactNode) => (
    <div
      style={{
        padding: "12px 15px",
        borderRadius: 12,
        background: "var(--chip)",
        color: ok ? "var(--fg)" : "var(--warn)",
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        fontSize: 13.5,
        lineHeight: 1.5,
      }}
    >
      {ok && <Check style={{ width: 16, height: 16, flex: "none", marginTop: 2 }} />}
      <span>{children}</span>
    </div>
  );
  const actionButton = (label: string, action: () => void, filled = true, disabled = false) => (
    <button
      type="button"
      onClick={action}
      disabled={disabled || busy || IS_DEMO}
      title={IS_DEMO ? t("set.demoReadOnly") : undefined}
      style={{
        ...pillBtn(filled),
        opacity: disabled || busy || IS_DEMO ? 0.45 : 1,
        cursor: disabled || busy || IS_DEMO ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );

  const telegramControls = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {actionButton(
          operation === "telegram-check" ? t("setup.testing") : t("setup.test"),
          () => void testTelegram(),
        )}
        {actionButton(
          t("setup.telegram.link"),
          () => void beginTelegramLink(),
          false,
          telegramResult?.ok === false,
        )}
      </div>
      {telegramResult &&
        (telegramResult.ok
          ? resultBox(true, t("setup.telegram.connected", { username: telegramResult.username }))
          : resultBox(false, telegramResult.error))}
      {linkResult?.ok === false && resultBox(false, linkResult.error)}
      {linkResult?.ok === true && (
        <a
          href={linkResult.link}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            ...pillBtn(true),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            alignSelf: "flex-start",
            textDecoration: "none",
          }}
        >
          {t("setup.telegram.open")}
          <ExternalLink style={{ width: 15, height: 15 }} />
        </a>
      )}
      {linkStatus.data?.status === "waiting" && resultBox(true, t("setup.telegram.waiting"))}
      {linkStatus.data?.status === "linked" &&
        resultBox(
          true,
          t("setup.telegram.linked", { name: linkStatus.data.name ?? String(linkStatus.data.userId ?? "") }),
        )}
      {linkStatus.data?.status === "expired" && resultBox(false, t("setup.telegram.expired"))}
      {linkStatus.data?.status === "error" &&
        resultBox(false, linkStatus.data.error ?? t("setup.testRequestFailed"))}
    </div>
  );
  const llmControls = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
      <div>
        {actionButton(operation === "llm-check" ? t("setup.testing") : t("setup.test"), () => void testLlm())}
      </div>
      {llmResult &&
        (llmResult.ok
          ? resultBox(true, t("setup.llm.connected", { model: llmResult.model, ms: llmResult.latencyMs }))
          : resultBox(false, llmResult.error))}
    </div>
  );
  const googleRedirect = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0 8px" }}>
      {oauthNotice &&
        resultBox(
          oauthNotice.ok,
          oauthNotice.ok
            ? t("setup.google.oauthSuccess")
            : (oauthNotice.message ?? t("setup.google.oauthError")),
        )}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("setup.google.redirect")}</span>
        <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
          <code
            style={{
              ...inputStyle(theme, false),
              overflowX: "auto",
              whiteSpace: "nowrap",
              color: "var(--fg)",
            }}
          >
            {google.data?.redirectUri ?? t("common.loading")}
          </code>
          <button
            type="button"
            onClick={() => void copyRedirect()}
            style={squareBtn}
            title={t("setup.copy")}
            aria-label={t("setup.copy")}
          >
            {copied ? (
              <Check style={{ width: 16, height: 16 }} />
            ) : (
              <Copy style={{ width: 16, height: 16 }} />
            )}
          </button>
        </div>
        {isDirty("PUBLIC_URL") && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--warn)" }}>{t("setup.google.urlPending")}</span>
            {actionButton(t("setup.google.updateRedirect"), () => void saveGoogleFields(), false)}
          </div>
        )}
      </div>
    </div>
  );
  const googleActions = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0 16px" }}>
      {google.data?.connected && resultBox(true, t("setup.google.connected"))}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {actionButton(
          operation === "google-connect" ? t("setup.saving") : t("setup.google.connect"),
          () => void connectGoogle(),
        )}
        {google.data?.connected &&
          actionButton(
            operation === "google-check" ? t("setup.testing") : t("setup.test"),
            () => void testGoogleConnection(),
            false,
          )}
      </div>
      {googleResult && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          {resultBox(
            googleResult.calendar === "ok",
            googleResult.calendar === "ok" ? t("setup.google.calendarOk") : googleResult.calendar,
          )}
          {resultBox(
            googleResult.tasks === "ok",
            googleResult.tasks === "ok" ? t("setup.google.tasksOk") : googleResult.tasks,
          )}
        </div>
      )}
    </div>
  );
  const googleControls = () => (
    <>
      {googleRedirect()}
      {googleActions()}
    </>
  );

  const telegramComplete = telegramResult?.ok === true && meta?.TELEGRAM_ALLOWED_USER_ID?.configured === true;
  const llmComplete = llmResult?.ok === true || meta?.[apiKeyFor(provider)]?.configured === true;
  const googleComplete = google.data?.connected === true;
  const passwordComplete = meta?.WEB_PASSWORD?.configured === true || currentValue("WEB_PASSWORD").length > 0;
  const completeSteps = [telegramComplete, llmComplete, googleComplete, passwordComplete];
  const finish = async () => {
    if (await persist(dirtyKeys)) await refreshConfiguration();
  };

  const setupPanel = () => {
    const commonPanel: React.CSSProperties = { ...panelStyle, padding: "26px 30px 12px" };
    const title = (group: SettingsGroupKey, key: TKey) => (
      <>
        <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: category(group, theme, GROUP_HUE[group]).bg,
            }}
          />
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 400, flex: 1 }}>{t(key)}</h2>
          {completeSteps[step] && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              <Check style={{ width: 15, height: 15 }} />
              {t("set.badge.ok")}
            </span>
          )}
          {helpButton(group)}
        </header>
        {renderHelp(group)}
      </>
    );
    if (step === 0)
      return (
        <section className="rg-panel" style={commonPanel}>
          {title("telegram", "setup.telegram.title")}
          {renderField("TELEGRAM_BOT_TOKEN")}
          {telegramControls()}
          {renderAdvanced("setup-telegram", ["TELEGRAM_ALLOWED_USER_ID"])}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 0" }}>
            {actionButton(
              t("setup.next"),
              () =>
                void persist(["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_ID"]).then(
                  (ok) => ok && setStep(1),
                ),
            )}
          </div>
        </section>
      );
    if (step === 1)
      return (
        <section className="rg-panel" style={commonPanel}>
          {title("model", "setup.llm.title")}
          {renderField("LLM_PROVIDER")}
          {renderField(apiKeyFor(provider))}
          {llmControls()}
          {renderAdvanced("setup-model", MODEL_ADVANCED)}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              padding: "14px 0",
              flexWrap: "wrap",
            }}
          >
            {actionButton(t("setup.back"), () => setStep(0), false)}
            {actionButton(t("setup.next"), () => void persist(modelKeys()).then((ok) => ok && setStep(2)))}
          </div>
        </section>
      );
    if (step === 2)
      return (
        <section className="rg-panel" style={commonPanel}>
          {title("google", "setup.google.title")}
          {googleRedirect()}
          {renderField("GOOGLE_CLIENT_ID")}
          {renderField("GOOGLE_CLIENT_SECRET")}
          {renderAdvanced("setup-google", ["PUBLIC_URL"])}
          {googleActions()}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              padding: "14px 0",
              flexWrap: "wrap",
            }}
          >
            {actionButton(t("setup.back"), () => setStep(1), false)}
            {actionButton(t("setup.next"), () => void saveGoogleFields().then((ok) => ok && setStep(3)))}
          </div>
        </section>
      );
    return (
      <section className="rg-panel" style={commonPanel}>
        {title("preferences", "setup.access.title")}
        {renderField("WEB_PASSWORD")}
        {renderField("LANGUAGE")}
        {renderField("TIMEZONE")}
        {renderAdvanced("setup-access", ["BRIEFING_TIME", "CALLMEBOT_USER"])}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            padding: "18px 0",
            flexWrap: "wrap",
          }}
        >
          {actionButton(t("setup.back"), () => setStep(2), false)}
          {actionButton(
            operation === "applying"
              ? t("setup.applying")
              : operation === "saving"
                ? t("setup.saving")
                : t("setup.finish"),
            () => void finish(),
            true,
            !passwordComplete,
          )}
        </div>
      </section>
    );
  };

  const settingsPanels = () =>
    groups.map(({ group, rows }) => {
      const providerRows = rows.filter((row) => visibleKey(row.key));
      const basic = providerRows.filter((row) => !advancedInSettings(group, row.key));
      const advanced = providerRows.filter((row) => advancedInSettings(group, row.key));
      const requiredMissing = providerRows.filter(
        (row) => row.meta.required && !row.meta.configured && !row.meta.envOnly,
      ).length;
      return (
        <section key={group} className="rg-panel" style={{ ...panelStyle, padding: "26px 30px 8px" }}>
          <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: category(group, theme, GROUP_HUE[group]).bg,
              }}
            />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, flex: 1 }}>{t(GROUP_LABEL[group])}</h2>
            <span
              style={{
                fontSize: 12,
                color: requiredMissing ? "var(--warn)" : "var(--muted)",
                background: "var(--chip)",
                borderRadius: 999,
                padding: "5px 12px",
              }}
            >
              {requiredMissing ? t("set.badge.missing", { n: requiredMissing }) : t("set.badge.ok")}
            </span>
            {helpButton(group)}
          </header>
          {renderHelp(group)}
          {basic.map((row) => renderField(row.key))}
          {group === "telegram" && telegramControls()}
          {group === "model" && llmControls()}
          {group === "google" && googleControls()}
          {advanced.length > 0 &&
            renderAdvanced(
              `settings-${group}`,
              advanced.map((row) => row.key),
            )}
        </section>
      );
    });
  const missingLeft = missing.filter((key) => !meta?.[key]?.configured && !isDirty(key));

  return (
    <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 16 }}>
      {setupMode && (
        <section className="rg-panel" style={{ ...panelStyle, padding: "28px 30px" }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{t("setup.title")}</h2>
          <p style={{ margin: "12px 0 20px", fontSize: 14.5, lineHeight: 1.65, color: "var(--muted)" }}>
            {t("setup.intro")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
            {STEP_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                style={{
                  border: 0,
                  borderRadius: 14,
                  padding: "11px 8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  background: index === step ? "var(--fg)" : "var(--chip)",
                  color: index === step ? "var(--bg)" : "var(--btn-fg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {completeSteps[index] ? (
                  <Check style={{ width: 14, height: 14 }} />
                ) : (
                  <span>{index + 1}</span>
                )}
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
          {missingLeft.length > 0 && (
            <p style={{ margin: "16px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
              {t("setup.progressHint")}
            </p>
          )}
        </section>
      )}
      {settings.isLoading && <div style={{ fontSize: 14, color: "var(--muted)" }}>{t("common.loading")}</div>}
      {settings.isError && <div style={{ fontSize: 14, color: "var(--warn)" }}>{t("set.loadError")}</div>}
      {settings.data && (setupMode ? setupPanel() : settingsPanels())}
      {!setupMode && settings.data && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "6px 4px 0" }}
        >
          {actionButton(
            operation === "applying"
              ? t("setup.applying")
              : operation === "saving"
                ? t("set.saving")
                : t("set.save"),
            () => void persist(dirtyKeys),
            true,
            dirtyKeys.length === 0,
          )}
          <button
            type="button"
            onClick={() => {
              setEdits({});
              setFieldErrors({});
              setSaveError("");
            }}
            disabled={dirtyKeys.length === 0 || busy}
            style={{ ...pillBtn(false), opacity: dirtyKeys.length === 0 || busy ? 0.45 : 1 }}
          >
            {t("set.discard")}
          </button>
          <span style={{ fontSize: 13, color: saveError ? "var(--warn)" : "var(--muted)" }}>
            {saveError ||
              (dirtyKeys.length === 0
                ? savedAt
                  ? t("set.saved")
                  : IS_DEMO
                    ? t("set.demoReadOnly")
                    : t("set.clean")
                : dirtyKeys.length === 1
                  ? t("set.dirty.one")
                  : t("set.dirty.many", { n: dirtyKeys.length }))}
          </span>
        </div>
      )}
      {setupMode && saveError && resultBox(false, saveError)}
      {restartFailed && resultBox(false, t("set.restartFailed"))}
      {operation === "applying" && (
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
            gap: 14,
            padding: 24,
            textAlign: "center",
          }}
        >
          <RotateCw style={{ width: 26, height: 26, animation: "rg-spin 1.1s linear infinite" }} />
          <span style={{ fontSize: 20, fontWeight: 300 }}>{t("setup.applying")}</span>
          <span style={{ fontSize: 14, color: "var(--muted)", maxWidth: 340, lineHeight: 1.6 }}>
            {t("set.restartingHint")}
          </span>
        </div>
      )}
    </div>
  );
}
