import { Hono } from "hono";
import { getAuthUrl, handleOAuthCallback } from "../google/auth.js";

export const oauthRoutes = new Hono();

oauthRoutes.get("/oauth/login", (c) => c.redirect(getAuthUrl()));

oauthRoutes.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("Falta el parámetro code", 400);
  try {
    await handleOAuthCallback(code);
    return c.html(
      `<div style="font-family:system-ui;padding:40px;font-size:18px">
        ✅ Google Calendar y Tasks conectados. Ya podés volver a Telegram.
      </div>`,
    );
  } catch (err) {
    return c.text(`Error conectando Google: ${(err as Error).message}`, 500);
  }
});
