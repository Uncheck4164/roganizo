import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config, isConfigured, missingKeys } from "./config.js";
import "./db/index.js";
import { serveStatic } from "@hono/node-server/serve-static";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { oauthRoutes } from "./http/oauth.js";
import { apiRoutes } from "./http/api.js";
import { onApplyRestart, settingsRoutes } from "./http/settings.js";
import { bot, setBotRunning } from "./bot/bot.js";
import { startScheduler } from "./scheduler.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", oauthRoutes);
app.route("/", apiRoutes);
// Mounted after apiRoutes so its own guard applies: /setup/status is public and
// /api/settings stays reachable while no web password exists yet.
app.route("/", settingsRoutes);

// Compiled SPA (apps/web/dist). In dev the Vite dev server with a proxy is used.
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);
if (fs.existsSync(webDist)) {
  const relRoot = path.relative(process.cwd(), webDist).replaceAll("\\", "/");
  app.use("/*", serveStatic({ root: relRoot }));
  app.get("*", serveStatic({ path: `${relRoot}/index.html` }));
}

// On Windows, tsx watch kills the process without signals and the port takes a
// while to be released: retry the listen instead of crashing with EADDRINUSE.
let server: ReturnType<typeof serve> | undefined;
function startHttp(attempt = 0) {
  server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`HTTP listening on http://localhost:${info.port}`);
  });
  server.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 20) {
      setTimeout(() => startHttp(attempt + 1), 500);
    } else {
      console.error("HTTP server error:", err);
      process.exit(1);
    }
  });
}
startHttp();

// Graceful shutdown (Docker/Dokploy send real SIGTERMs).
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    server?.close();
    void bot
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

// Applying settings from the UI restarts the process; the supervisor brings it
// back up with the new configuration.
onApplyRestart(async () => {
  server?.close();
  await bot.stop().catch(() => {});
});

if (isConfigured()) {
  bot
    .start({
      onStart: (me) => {
        setBotRunning(true);
        console.log(`Bot @${me.username} listening (long-polling)`);
      },
    })
    .catch((err) => {
      setBotRunning(false);
      console.error(
        "The Telegram bot could not start (invalid token?). The web app keeps working.",
        (err as Error).message,
      );
    });
  startScheduler();
} else {
  console.log(
    `Setup pending: open ${config.PUBLIC_URL} in your browser to finish the configuration.`,
  );
  console.log(`Missing or invalid settings: ${missingKeys.join(", ")}`);
}
