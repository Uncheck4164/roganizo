# Roganizo

**Your personal assistant on Telegram — talk to it in plain language, and it organizes your Google Calendar, your tasks, your notes and your reminders.**

[![License](https://img.shields.io/badge/License-MIT-black?style=flat)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-Demo-2ea44f?style=flat)](https://uncheck4164.github.io/roganizo/)
[![Docker](https://img.shields.io/badge/Docker-coming%20soon-2496ED?style=flat&logo=docker&logoColor=white)](#quickstart-docker)
[![Build](https://img.shields.io/github/actions/workflow/status/Uncheck4164/roganizo/pages.yml?branch=main&style=flat&label=build)](https://github.com/Uncheck4164/roganizo/actions/workflows/pages.yml)

<!-- When Docker Hub publishing is enabled (see docs/publishing.md), replace the Docker badge above with:
[![Docker](https://img.shields.io/docker/v/TODO-dockerhub-user/roganizo?style=flat&logo=docker&logoColor=white&label=docker)](https://hub.docker.com/r/TODO-dockerhub-user/roganizo)
-->

[![LANG ENGLISH](https://img.shields.io/badge/LANG-ENGLISH-0b7285?style=flat)](README.md)
[![LANG ESPAÑOL](https://img.shields.io/badge/LANG-ESPA%C3%91OL-adb5bd?style=flat)](README.es.md)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=flat&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/TODO-bmc-user)

Roganizo is a **single-user** assistant. You write to it on **Telegram** the same way you would
write to a friend, and it turns that into real events in **Google Calendar**, to-dos in
**Google Tasks**, notes and reminders. It also ships a **read-only web panel** (calendar,
to-dos, notes and stats) protected by a password — every change goes through the bot, so nobody
else can touch anything.

![Roganizo — web panel](docs/screenshot-dark.png)

**🔗 [Live demo](https://uncheck4164.github.io/roganizo/)** — the web panel with fictional data
and no backend. The bot and the real synchronization require self-hosting.

## What it can do

- 🗓 *"my schedule: monday 8am science, 9 math, tuesday 3pm biology"* → recurring weekly events
  (with a summary and **Confirm / Cancel** buttons when there are three or more).
- *"after biology I want to study, but 20 minutes of lunch first"* → it reads the calendar and
  creates the whole chain for you.
- *"when do you recommend I study on tuesday?"* → it analyzes your real free slots.
- *"remind me about the exam on tuesday september 28"* → a Telegram message that day.
- **Urgent** reminders ("keep insisting until I confirm"): a message with a "✅ Got it" button
  5 minutes **before** the time and, if you do not confirm, **it calls you on Telegram**
  (via CallMeBot) at the exact time.
- It detects schedule overlaps and warns you instead of creating events blindly.
- A morning briefing: the day's agenda + to-dos + reminders.
- Notes and to-dos over chat; everything visible in the web panel.

## Quickstart (Docker)

One single container: bot + API + web + scheduler. The SQLite database lives in the `/data`
volume.

### Path A — zero config (recommended)

Start the container with no configuration at all and set everything up from your browser.

```bash
docker build -t roganizo .
docker run -d --name roganizo --restart unless-stopped \
  -v roganizo-data:/data -p 8080:8080 roganizo
```

Open **http://localhost:8080** and follow the guided setup: Telegram token, Google OAuth,
OpenRouter key, web password, timezone and language. The wizard has step-by-step help for each
provider, and the settings are stored in SQLite inside the `/data` volume.

> `--restart unless-stopped` is not optional: saving the settings restarts the process so the
> new configuration is picked up, and Docker has to bring the container back up.

### Path B — with a `.env` file

If you already have your credentials, you can pass them as environment variables.

```bash
cp .env.example .env   # fill in your credentials
docker build -t roganizo .
docker run -d --name roganizo --restart unless-stopped \
  --env-file .env -v roganizo-data:/data -p 8080:8080 roganizo
```

Both paths can be mixed: anything missing from `.env` can be completed later from the browser,
and anything you change in the browser takes precedence.

<!-- Coming soon: prebuilt image on Docker Hub (see docs/publishing.md)
docker pull TODO-dockerhub-user/roganizo
-->
**Coming soon:** a prebuilt image (`docker pull TODO-dockerhub-user/roganizo`), so you will not
even need to build it yourself.

Since everything is a plain `Dockerfile`, this also runs unchanged on any Dockerfile-based PaaS
(Dokploy, Coolify, Portainer, Railway, Fly.io…): point it at this repository, mount a volume on
`/data`, expose port **8080** over HTTPS, and set `PUBLIC_URL` to your domain.

## Step-by-step prerequisites (one time only)

You will need three things: a Telegram bot, Google credentials and an OpenRouter key. Everything
below is free.

### 1. Telegram bot

1. Open Telegram and talk to **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. It asks for a **display name** — anything you like, for example `Roganizo`.
4. It asks for a **username** — it must be unique and **end in `bot`**, for example
   `roganizo_ramiro_bot`.
5. BotFather replies with a **token** that looks like `123456789:AAE...`. Copy it — that is
   `TELEGRAM_BOT_TOKEN`.
6. Now find your **numeric user ID**: talk to **[@userinfobot](https://t.me/userinfobot)** and
   send `/start`. It replies with your ID (a number like `123456789`). That is
   `TELEGRAM_ALLOWED_USER_ID`, and the bot ignores every other user.

<details>
<summary><b>Optional — phone calls for urgent reminders (CallMeBot)</b></summary>

If you want Roganizo to actually **call you on Telegram** when you do not confirm an urgent
reminder, you need to authorize CallMeBot once:

1. Send `/start` to **[@CallMeBot_txtbot](https://t.me/CallMeBot_txtbot)** (this is the
   authorization step described on [callmebot.com](https://www.callmebot.com/blog/telegram-call-api/);
   the site also offers a login link as an alternative).
2. Set `CALLMEBOT_USER` to your Telegram **@username** (the public one, not the numeric ID).

Leave `CALLMEBOT_USER` empty to disable calls entirely — urgent reminders still work, they just
stay as Telegram messages. CallMeBot is a free third-party service; if their activation flow
changes, follow the instructions on their site.

</details>

### 2. Google Cloud (Calendar + Tasks)

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and sign in with the
   Google account whose calendar you want to organize.
2. Create a **new project** (top bar → project selector → *New project*). Any name works.
3. Go to **APIs & Services → Library** and enable **both**:
   - **Google Calendar API**
   - **Google Tasks API**
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized redirect URIs**, add your callback:
   - production: `https://YOUR-DOMAIN/oauth/callback`
   - local development: `http://localhost:8080/oauth/callback`

   It must match `PUBLIC_URL` + `/oauth/callback` exactly, including `http`/`https` and the port.
7. Save and copy the **Client ID** (`...apps.googleusercontent.com`) and the **Client secret**
   (`GOCSPX-...`). Those are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
8. Go to the **OAuth consent screen** and add your own Gmail address under **Test users**.
   That is enough — you do **not** need to publish or verify the app, since you are the only
   user.

### 3. OpenRouter (the LLM)

1. Create an account at **[openrouter.ai](https://openrouter.ai)**.
2. Go to **[openrouter.ai/keys](https://openrouter.ai/keys)** and create a key
   (`sk-or-v1-...`). That is `OPENROUTER_API_KEY`.
3. Add some credit, or pick one of the free models — the default is
   `deepseek/deepseek-v4-flash-0731`, but **any model available on OpenRouter works**: just
   change `OPENROUTER_MODEL` (or pick it in the settings UI). The model needs to support
   tool-calling.

## Configuration

You can configure Roganizo in two ways, and you can freely mix them:

- **From the browser** — open the panel and click the **gear icon** to reach the settings screen.
  It has built-in step-by-step help for each provider, and the values are saved in SQLite.
- **With environment variables** — a `.env` file (see `.env.example`) or your PaaS's environment
  panel.

**Precedence: UI / database > environment variable > default.** In other words, anything you
save from the settings screen wins over what the environment says. Saving settings restarts the
process so the new values take effect (hence `--restart unless-stopped`).

The only exception is `DATABASE_PATH`: since it decides *where the settings themselves live*, it
can only be set as an environment variable.

| Variable | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Your numeric user ID — the bot ignores everyone else |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | LLM (default `deepseek/deepseek-v4-flash-0731`) |
| `OPENROUTER_PROVIDER_ORDER` | Preferred providers, in order; accepts a quantization variant (default `deepinfra/fp4,baidu`) |
| `OPENROUTER_SORT` | Fallback criterion: `price` (default), `throughput` or `latency` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth credentials |
| `PUBLIC_URL` | Public URL (OAuth callback + links sent by the bot) |
| `PORT` | HTTP port (default 8080) |
| `WEB_PASSWORD` | Password for the read-only web panel |
| `WEB_SESSION_SECRET` | Secret used to sign the session cookie — **auto-generated if absent**, and still overridable |
| `CALLMEBOT_USER` | Your Telegram @username for urgent calls (empty = no calls) |
| `LANGUAGE` | `es` or `en` (default `es`) — language of the bot and the morning briefing. The web panel has its own ES/EN toggle |
| `TIMEZONE` | Default `America/Santiago` |
| `BRIEFING_TIME` | Morning briefing time, `HH:mm` (empty = disabled) |
| `DATABASE_PATH` | **Environment only.** Default `/data/roganizo.db` in Docker |

## Local development

```bash
pnpm install
pnpm dev               # server + bot on :8080
pnpm dev:web           # SPA with hot-reload on :5173 (proxied to :8080)
```

Open http://localhost:8080 and complete the browser setup, or `cp .env.example .env` and fill it
in by hand if you prefer.

First run: send `/start` to the bot → it replies with a link to connect Google → done.

## Bot commands

- `/start` — welcome message, plus the Google connection link if it is missing
- `/web` — link to the web panel
- `/reset` — clears the conversation memory

## Architecture

```
Telegram ⇄ grammY ⇄ LLM agent (OpenRouter, tool-calling)
                        ├─ Google Calendar (events, RRULE, free slots, conflicts)
                        ├─ Google Tasks (to-dos)
                        └─ SQLite (notes, reminders, history, settings)
Scheduler (60s) → reminders + morning briefing over Telegram
Hono → /oauth/* · /api/* (GET only, session-protected) · React SPA
```

Everything runs inside a single container: bot, HTTP API, web panel and scheduler. The bot uses
long-polling, so there is no Telegram webhook to configure.

## License

MIT — see [LICENSE](LICENSE).

© 2026 Ramiro Figueroa ([Uncheck4164](https://github.com/Uncheck4164)).

## Support

If Roganizo saves you time, you can
[buy me a coffee](https://buymeacoffee.com/TODO-bmc-user) ☕. Entirely optional — the project is
free, self-hosted and will stay that way. Starring the repository or reporting an issue helps
just as much.
