import { Hono } from "hono";
import { checkModel, providerName } from "../agent/llm.js";
import { isBotRunning } from "../bot/bot.js";
import { config } from "../config.js";
import {
  checkGoogleAccess,
  isGoogleClientConfigured,
  isGoogleConnected,
  redirectUri,
} from "../google/auth.js";
import { t } from "../i18n.js";
import { checkToken, linkStatus, startLink } from "../setup/telegramLink.js";
import { apiKeyFor } from "../settings/schema.js";
import { requireSessionUnlessSetup } from "./settings.js";

/**
 * Checks the setup assistant runs step by step. Each one works on the SAVED
 * configuration (the page saves a step's fields before testing them), so what
 * passes here is exactly what the bot will use.
 */
export const setupRoutes = new Hono();

setupRoutes.use("/api/setup/*", requireSessionUnlessSetup);

setupRoutes.post("/api/setup/telegram/check", async (c) => c.json(await checkToken()));

setupRoutes.post("/api/setup/telegram/link", async (c) => c.json(await startLink(isBotRunning())));

setupRoutes.get("/api/setup/telegram/link", (c) => c.json(linkStatus()));

setupRoutes.post("/api/setup/llm/check", async (c) => {
  // Without a key the provider answers 401, which reads as "your key is wrong".
  if (!config[apiKeyFor(config.LLM_PROVIDER)]) {
    return c.json({ ok: false, model: "", error: t("setupLlmNoKey", { provider: providerName() }) });
  }
  const result = await checkModel();
  return c.json(
    result.ok
      ? { ok: true, provider: result.provider ?? providerName(), model: result.model, latencyMs: result.latencyMs }
      : { ok: false, model: result.model, error: result.error ?? "" },
  );
});

setupRoutes.get("/api/setup/google", (c) =>
  c.json({
    redirectUri: redirectUri(),
    clientConfigured: isGoogleClientConfigured(),
    connected: isGoogleConnected(),
  }),
);

setupRoutes.post("/api/setup/google/check", async (c) => {
  if (!isGoogleConnected()) {
    const error = t("setupGoogleNotConnected");
    return c.json({ ok: false, calendar: error, tasks: error });
  }
  const { calendar, tasks } = await checkGoogleAccess();
  return c.json({ ok: calendar === "ok" && tasks === "ok", calendar, tasks });
});
