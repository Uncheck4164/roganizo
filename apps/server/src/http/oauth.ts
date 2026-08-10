import { Hono } from "hono";
import { getAuthUrl, handleOAuthCallback } from "../google/auth.js";
import { t } from "../i18n.js";

export const oauthRoutes = new Hono();

oauthRoutes.get("/oauth/login", (c) => c.redirect(getAuthUrl()));

oauthRoutes.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text(t("oauthMissingCode"), 400);
  try {
    await handleOAuthCallback(code);
    return c.html(
      `<div style="font-family:system-ui;padding:40px;font-size:18px">
        ${t("oauthSuccess")}
      </div>`,
    );
  } catch (err) {
    return c.text(t("oauthError", { message: (err as Error).message }), 500);
  }
});
