# MCP server

`apps/mcp` exposes a running Roganizo instance to an MCP client (Claude Code, Claude Desktop,
any other) so an assistant can read the instance directly instead of being told what it shows.

It wraps the HTTP API the web panel already uses: it logs in with the web password, keeps the
session cookie, and turns each endpoint into a tool.

## Tools

| Tool              | Endpoint              | What it answers                                     |
| ----------------- | --------------------- | --------------------------------------------------- |
| `health`          | all of them           | HTTP status of every endpoint, plus a verdict        |
| `status`          | `/api/status`         | bot running, Google linked, timezone, instance clock |
| `events`          | `/api/events`         | calendar events in a range (`from`, `to`, or `days`) |
| `event`           | `/api/events/:id`     | one event by id, or a series master by seriesId      |
| `tasks`           | `/api/tasks`          | Google Tasks to-dos                                  |
| `notes`           | `/api/notes`          | notes stored in SQLite                               |
| `reminders`       | `/api/reminders`      | reminders that have not fired                        |
| `stats`           | `/api/stats`          | hours per activity and task counts for a week        |
| `preview_changes` | `/api/calendar/plan`  | validates calendar changes, writes nothing           |
| `apply_changes`   | `/api/calendar/plan`  | applies calendar changes for real                    |

## Writing to the calendar

`preview_changes` and `apply_changes` take a list of `{ tool, args }` actions — `create_event`,
`update_event`, `delete_event` — and hand them to the *same* validation and the *same* executor
the Telegram confirmation card uses. What they skip is the human tapping Confirm, so the server
compensates:

- **Errors always refuse the whole plan**, and nothing is applied: a stale or invented id, an end
  before its start, the same event created twice inside one plan.
- **Warnings refuse it too**, unless the call passes `acknowledgeWarnings: true`. Overlaps and
  "an identical event is already there" land here — things a human would want to see rather than
  have decided for them.
- Replaying an apply is safe: creating an event identical to an existing one is skipped rather
  than duplicated, and deleting something already gone reports as such.

Actions are sorted before running — deletes, then moves, then creates — so a slot freed by the
same plan is actually free when something is created in it.

Always `preview_changes` first. It runs the full validation and returns the rendered plan without
touching Google.

### Editing a recurring series

An `event_id` ending in `_20260820T003000Z` is a single occurrence; the `seriesId` is the whole
series. To change the time of a series, read the master with `event` first and reuse **its**
start date with the new time. Google generates the series from the master's start, so passing a
different date moves the anchor and drops every occurrence before it. Changing only the title has
no such catch.

Note that editing a series changes occurrences already in the past too. Google implements "this
and all following" by splitting the series, which the app does not do.

### Start with `health`

The web panel renders every failure as empty state: when `/api/events` returns 500, the grid just
looks like a week with nothing in it. `health` exists so that ambiguity disappears in one call —
it probes every endpoint and prints the status codes side by side:

```
  /health          200  ok
  /api/status      200  ok
  /api/events      500  Internal Server Error
  /api/tasks       500  Internal Server Error
  /api/notes       200  4 items
  /api/reminders   200  0 items
  /api/stats       500  Internal Server Error

Verdict:
  Every Google-backed endpoint fails and everything else works, so the Google
  authorisation is the common cause: an expired or revoked refresh token, or the
  Calendar/Tasks APIs disabled in the Cloud project.
```

Google-backed endpoints failing *together* points at the authorization; only one of them failing
points at a scope that was not granted or an API left disabled in the Cloud project. Note that
`status` reporting `google: true` proves nothing here — that flag only checks that a token row
exists in the database, not that the token still works.

## Setup

```bash
pnpm install
pnpm build:mcp
cp apps/mcp/.env.example apps/mcp/.env   # then fill it in
```

`apps/mcp/.env` takes two values:

- `ROGANIZO_URL` — base URL of the instance. Defaults to `http://localhost:8080`.
- `ROGANIZO_PASSWORD` — the web password **of that instance**. A deployed instance keeps its
  password in its own database, so it is usually not the `WEB_PASSWORD` in your local `.env`
  (which is what the MCP falls back to when `ROGANIZO_PASSWORD` is unset, so a local checkout
  works with no configuration at all).

The root `.gitignore` ignores `.env` at any depth, so the password stays out of the repository.

Then register the server with your client. In Claude Code:

```bash
claude mcp add roganizo --scope user -- node /absolute/path/to/apps/mcp/dist/index.js
```

Check it with `claude mcp list`, which health-checks every server and should report
`roganizo — ✔ Connected`.

Use an **absolute** path and `--scope user`. A project-scoped `.mcp.json` works too, but its
command is resolved against the working directory, so it only starts when the client was opened
at the repo root — and it stays `⏸ Pending approval` until you approve it at startup, which is
easy to miss. Do not register it in both scopes: `claude mcp list` reports the two definitions as
a conflict.

Clients with their own configuration file want the same command and absolute path. Environment
variables passed by the client override `apps/mcp/.env`, which is the way to point one client at
production and another at a local instance.

## Notes

- The transport is stdio, so the client starts and stops the process; nothing listens on a port.
- Rebuild (`pnpm build:mcp`) after changing anything under `apps/mcp/src`, and restart the client
  so it picks up the new build.
- Tool input schemas are declared as raw shapes rather than `z.object()`. The SDK prefers
  `z.object()`, but that overload needs a schema exposing `~standard.jsonSchema`, which zod 4.4.3
  does not ship yet.
