import { Hono } from "hono";
import { consumeState, getAuthUrl, handleOAuthCallback } from "../google/auth.js";
import { t } from "../i18n.js";

export const oauthRoutes = new Hono();

// ?return=setup sends the browser back to the setup assistant afterwards;
// without it (the link the bot sends) the callback shows a plain page.
oauthRoutes.get("/oauth/login", (c) =>
  c.redirect(getAuthUrl(c.req.query("return") === "setup" ? "setup" : "bot")),
);

oauthRoutes.get("/oauth/callback", async (c) => {
  const returnTo = consumeState(c.req.query("state"));
  const back = (outcome: "connected" | "error", message?: string) =>
    c.redirect(`/?google=${outcome}${message ? `&message=${encodeURIComponent(message)}` : ""}`);

  if (!returnTo) return c.text(t("oauthBadState"), 400);
  // Google sends ?error=access_denied when the user cancels the consent screen.
  const denied = c.req.query("error");
  const code = c.req.query("code");
  if (denied || !code) {
    const message = denied ? t("oauthDenied", { error: denied }) : t("oauthMissingCode");
    return returnTo === "setup" ? back("error", message) : c.text(message, 400);
  }
  try {
    await handleOAuthCallback(code);
  } catch (err) {
    const message = t("oauthError", { message: (err as Error).message });
    return returnTo === "setup" ? back("error", message) : c.text(message, 500);
  }
  if (returnTo === "setup") return back("connected");
  return c.html(
    `<div style="font-family:system-ui;padding:40px;font-size:18px">
        ${t("oauthSuccess")}
      </div>`,
  );
});
