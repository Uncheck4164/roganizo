import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import "./db/index.js";
import { serveStatic } from "@hono/node-server/serve-static";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { oauthRoutes } from "./http/oauth.js";
import { apiRoutes } from "./http/api.js";
import { bot, setBotRunning } from "./bot/bot.js";
import { startScheduler } from "./scheduler.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", oauthRoutes);
app.route("/", apiRoutes);

// SPA compilada (apps/web/dist). En dev se usa el dev server de Vite con proxy.
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);
if (fs.existsSync(webDist)) {
  const relRoot = path.relative(process.cwd(), webDist).replaceAll("\\", "/");
  app.use("/*", serveStatic({ root: relRoot }));
  app.get("*", serveStatic({ path: `${relRoot}/index.html` }));
}

// En Windows, tsx watch mata el proceso sin señales y el puerto tarda en
// soltarse: reintentar el listen en vez de crashear con EADDRINUSE.
let server: ReturnType<typeof serve>;
function startHttp(attempt = 0) {
  server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`HTTP escuchando en http://localhost:${info.port}`);
  });
  server.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 20) {
      setTimeout(() => startHttp(attempt + 1), 500);
    } else {
      console.error("Error del servidor HTTP:", err);
      process.exit(1);
    }
  });
}
startHttp();

// Shutdown ordenado (Docker/Dokploy mandan SIGTERM de verdad).
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    server?.close();
    void bot.stop().finally(() => process.exit(0));
  });
}

bot
  .start({
    onStart: (me) => {
      setBotRunning(true);
      console.log(`Bot @${me.username} escuchando (long-polling)`);
    },
  })
  .catch((err) => {
    setBotRunning(false);
    console.error(
      "El bot de Telegram no pudo arrancar (¿token inválido?). La web sigue funcionando.",
      (err as Error).message,
    );
  });
startScheduler();
