import { randomBytes } from "node:crypto";
import { config, reloadConfig } from "../config.js";
import { t } from "../i18n.js";
import { writeMany } from "../settings/store.js";

/**
 * Setup helpers that talk to the Telegram Bot API directly, without grammY:
 * during setup the bot is not running yet (its token is bound at construction,
 * and it only starts once the configuration is complete).
 *
 * Linking replaces "ask @userinfobot for your numeric ID and paste it": the
 * setup page hands out a t.me deep link with a one-time code, the user taps
 * Start, and whoever sends that code becomes TELEGRAM_ALLOWED_USER_ID.
 */

const LINK_TTL_MS = 10 * 60 * 1000;
const POLL_TIMEOUT_S = 25;

interface ApiResult<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: TelegramUser };
}

async function api<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000),
  });
  return (await res.json()) as ApiResult<T>;
}

export type TokenCheck = { ok: true; username: string; name: string } | { ok: false; error: string };

/** getMe with the saved token: proves the token and reports which bot it is. */
export async function checkToken(token = config.TELEGRAM_BOT_TOKEN): Promise<TokenCheck> {
  if (!token) return { ok: false, error: t("setupTelegramNoToken") };
  try {
    const me = await api<{ username: string; first_name: string }>(token, "getMe");
    if (!me.ok || !me.result) {
      const rejected = me.error_code === 401 || me.error_code === 404;
      return { ok: false, error: rejected ? t("setupTelegramInvalid") : (me.description ?? "getMe failed") };
    }
    return { ok: true, username: me.result.username, name: me.result.first_name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type LinkStatus = "idle" | "waiting" | "linked" | "expired" | "error";

let link: {
  status: LinkStatus;
  code?: string;
  token?: string;
  expiresAt?: number;
  userId?: number;
  name?: string;
  error?: string;
} = { status: "idle" };
let polling = false;

export function linkStatus() {
  if (link.status === "waiting" && Date.now() > (link.expiresAt ?? 0)) link = { status: "expired" };
  const { status, userId, name, error } = link;
  return { status, userId, name, error };
}

/**
 * Opens a linking window. With the bot already running, its middleware hands
 * /start payloads to claimLink(); otherwise this polls getUpdates itself.
 */
export async function startLink(botRunning: boolean) {
  const token = config.TELEGRAM_BOT_TOKEN;
  const me = await checkToken(token);
  if (!me.ok) return me;
  const code = randomBytes(12).toString("base64url");
  const expiresAt = Date.now() + LINK_TTL_MS;
  link = { status: "waiting", code, token, expiresAt };
  if (!botRunning) void pollForStart(token);
  return {
    ok: true as const,
    username: me.username,
    link: `https://t.me/${me.username}?start=${code}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** Handles `/start <payload>`. True when the payload was a linking code. */
export async function claimLink(
  payload: string,
  from: TelegramUser,
  reply: (text: string) => Promise<unknown>,
): Promise<boolean> {
  if (link.status !== "waiting" || payload !== link.code) return false;
  if (Date.now() > (link.expiresAt ?? 0)) {
    link = { status: "expired" };
    await reply(t("setupLinkExpired"));
    return true;
  }
  const name = from.first_name ?? (from.username ? `@${from.username}` : String(from.id));
  writeMany({ TELEGRAM_ALLOWED_USER_ID: String(from.id) });
  reloadConfig();
  link = { status: "linked", userId: from.id, name };
  console.log(`[setup] linked Telegram user ${from.id} (${name})`);
  await reply(t("setupLinked", { name }));
  return true;
}

export const START_PAYLOAD = /^\/start(?:@\w+)?\s+(\S+)/;

async function pollForStart(token: string): Promise<void> {
  if (polling) return;
  polling = true;
  let offset = 0;
  try {
    // Skip the backlog: only a /start sent after the link was created counts.
    const backlog = await api<Update[]>(token, "getUpdates", { offset: -1, timeout: 0 });
    const last = backlog.result?.at(-1);
    if (last) offset = last.update_id + 1;

    while (link.status === "waiting" && link.token === token && Date.now() < (link.expiresAt ?? 0)) {
      let res: ApiResult<Update[]>;
      try {
        res = await api<Update[]>(token, "getUpdates", {
          offset,
          timeout: POLL_TIMEOUT_S,
          allowed_updates: ["message"],
        });
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok) {
        // 409: something else is long-polling this bot, so updates never reach us.
        if (res.error_code === 409) {
          link = { status: "error", error: t("setupTelegramBusy") };
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const update of res.result ?? []) {
        offset = update.update_id + 1;
        const message = update.message;
        const payload = message?.text?.match(START_PAYLOAD)?.[1];
        if (!message?.from || !payload) continue;
        await claimLink(payload, message.from, (text) =>
          api(token, "sendMessage", { chat_id: message.chat.id, text }),
        );
      }
    }
  } catch (err) {
    console.error("[setup] Telegram link polling failed:", (err as Error).message);
  } finally {
    // Acknowledge what was read, so the bot does not replay it once it starts.
    if (offset) await api(token, "getUpdates", { offset, timeout: 0 }).catch(() => {});
    polling = false;
  }
}
