# MCP server

`apps/mcp` exposes a running Roganizo instance to an MCP client (Claude Code, Claude Desktop,
any other) so an assistant can read the instance directly instead of being told what it shows.

It is a thin, **read-only** wrapper over the HTTP API the web panel already uses: it logs in with
the web password, keeps the session cookie, and turns each `GET` into a tool. There are no write
tools on purpose — every calendar change goes through the confirmation card in Telegram, and an
MCP tool that created or deleted events would be a way around that.

## Tools

| Tool        | Endpoint            | What it answers                                              |
| ----------- | ------------------- | ------------------------------------------------------------ |
| `health`    | all of them         | HTTP status of every endpoint, plus a verdict                 |
| `status`    | `/api/status`       | bot running, Google linked, timezone, instance clock          |
| `events`    | `/api/events`       | calendar events in a range (`from`, `to`, or `days`)          |
| `tasks`     | `/api/tasks`        | Google Tasks to-dos                                           |
| `notes`     | `/api/notes`        | notes stored in SQLite                                        |
| `reminders` | `/api/reminders`    | reminders that have not fired                                 |
| `stats`     | `/api/stats`        | hours per activity and task counts for a week                 |

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

The repo ships an `.mcp.json` that registers the server for MCP clients that read it:

```json
{
  "mcpServers": {
    "roganizo": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"]
    }
  }
}
```

Clients that take their own configuration file want the same command, with an absolute path to
`apps/mcp/dist/index.js`. Environment variables passed by the client override `apps/mcp/.env`,
which is the way to point one client at production and another at a local instance.

## Notes

- The transport is stdio, so the client starts and stops the process; nothing listens on a port.
- Rebuild (`pnpm build:mcp`) after changing anything under `apps/mcp/src`, and restart the client
  so it picks up the new build.
- Tool input schemas are declared as raw shapes rather than `z.object()`. The SDK prefers
  `z.object()`, but that overload needs a schema exposing `~standard.jsonSchema`, which zod 4.4.3
  does not ship yet.
