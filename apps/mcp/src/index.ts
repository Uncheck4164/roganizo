import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { readConfig } from "./config.js";
import { RoganizoClient, type Fetched } from "./client.js";

// Tools declare their input as a raw shape rather than the z.object() the SDK
// docs prefer: that overload wants a schema exposing `~standard.jsonSchema`, and
// zod 4.4.3 (current latest) does not ship it yet. Wrap them in z.object() once
// zod does — the runtime behaviour is identical, the SDK wraps the shape itself.

const config = readConfig();
const client = new RoganizoClient(config.url, config.password);

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

/** Turns a request into tool output, keeping status and body on failure. */
function present<T>(what: string, r: Fetched<T>): CallToolResult {
  if (r.ok) return text(JSON.stringify(r.data, null, 2));
  const status = r.status === 0 ? "no response" : `HTTP ${r.status}`;
  return text(
    `${what} failed on ${config.url} (${status}).\n\n${r.body}\n\n` +
      `Run the "health" tool to see whether the rest of the instance is affected too.`,
    true,
  );
}

/** Defaults to a week from today; `to` wins over `days` when both are given. */
function resolveRange(from?: string, to?: string, days = 7): { from: string; to: string } {
  const start = from ?? isoDate(new Date());
  if (to) return { from: start, to };
  const end = new Date(`${start.slice(0, 10)}T00:00:00`);
  end.setDate(end.getDate() + days);
  return { from: start, to: isoDate(end) };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "roganizo", version: "0.1.0" });

  server.registerTool(
    "status",
    {
      description:
        "Whether the Telegram bot is running, whether Google is linked, and the instance timezone and clock. " +
        "Note the Google flag only checks that a token row exists, not that the token still works — use \"health\" for that.",
      inputSchema: {},
    },
    async () => present("GET /api/status", await client.get("/api/status")),
  );

  server.registerTool(
    "events",
    {
      description: "Calendar events in a date range, straight from the instance's Google Calendar.",
      inputSchema: {
        from: z.string().optional().describe("ISO date or datetime. Defaults to today."),
        to: z.string().optional().describe("ISO date or datetime. Overrides `days` when given."),
        days: z.number().int().min(1).max(180).optional().describe("Range length from `from`. Default 7."),
      },
    },
    async ({ from, to, days }) => {
      const range = resolveRange(from, to, days);
      const qs = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      return present(`GET /api/events (${range.from} → ${range.to})`, await client.get(`/api/events?${qs}`));
    },
  );

  server.registerTool(
    "event",
    {
      description:
        "One event by id. Passing a seriesId returns the master of a recurring event, whose start " +
        "is the anchor the series is generated from. Read it before changing the time of a whole " +
        "series: reuse that anchor date with the new time, or Google moves the series start and " +
        "drops every occurrence before it.",
      inputSchema: {
        id: z.string().describe("Event id or seriesId, from the `events` tool."),
      },
    },
    async ({ id }) =>
      present(`GET /api/events/${id}`, await client.get(`/api/events/${encodeURIComponent(id)}`)),
  );

  server.registerTool(
    "tasks",
    {
      description: "Google Tasks to-dos, including completed ones. Priority is encoded as \"Prioridad: Alta|Media|Baja\" on the first line of the notes.",
      inputSchema: {},
    },
    async () => present("GET /api/tasks", await client.get("/api/tasks")),
  );

  server.registerTool(
    "notes",
    { description: "Notes stored in the instance's SQLite database.", inputSchema: {} },
    async () => present("GET /api/notes", await client.get("/api/notes")),
  );

  server.registerTool(
    "reminders",
    { description: "Reminders that have not fired yet.", inputSchema: {} },
    async () => present("GET /api/reminders", await client.get("/api/reminders")),
  );

  server.registerTool(
    "stats",
    {
      description: "Hours per activity and task counts for a week.",
      inputSchema: {
        week: z.string().optional().describe("Any ISO date inside the target week. Defaults to the current week."),
      },
    },
    async ({ week }) =>
      present("GET /api/stats", await client.get(`/api/stats${week ? `?week=${encodeURIComponent(week)}` : ""}`)),
  );

  server.registerTool(
    "health",
    {
      description:
        "Probes every endpoint and reports the HTTP status of each. Use this first when something looks empty or broken: " +
        "the web UI renders failures as empty state, so a 500 is indistinguishable from 'no data' in the browser.",
      inputSchema: {},
    },
    async () => {
      const today = isoDate(new Date());
      const tomorrow = resolveRange(today, undefined, 1).to;
      const probes = [
        { label: "/health", path: "/health", auth: false, google: false },
        { label: "/api/status", path: "/api/status", auth: true, google: false },
        {
          label: "/api/events",
          path: `/api/events?from=${today}&to=${tomorrow}`,
          auth: true,
          google: true,
        },
        { label: "/api/tasks", path: "/api/tasks", auth: true, google: true },
        { label: "/api/notes", path: "/api/notes", auth: true, google: false },
        { label: "/api/reminders", path: "/api/reminders", auth: true, google: false },
        { label: "/api/stats", path: "/api/stats", auth: true, google: true },
      ];

      const lines: string[] = [`Instance: ${config.url}`, ""];
      const failed = new Set<string>();
      let statusBody: { google?: boolean } | undefined;

      for (const p of probes) {
        const r = await client.get<unknown>(p.path, { auth: p.auth });
        if (r.ok) {
          const shape = Array.isArray(r.data) ? `${r.data.length} items` : "ok";
          lines.push(`  ${p.label.padEnd(16)} ${String(r.status).padEnd(4)} ${shape}`);
          if (p.label === "/api/status") statusBody = r.data as { google?: boolean };
        } else {
          failed.add(p.label);
          const status = r.status === 0 ? "----" : String(r.status);
          lines.push(`  ${p.label.padEnd(16)} ${status.padEnd(4)} ${r.body.replace(/\s+/g, " ")}`);
        }
      }

      const googleProbes = probes.filter((p) => p.google).map((p) => p.label);
      const googleDown = googleProbes.filter((l) => failed.has(l));

      lines.push("", "Verdict:");
      if (failed.size === 0) {
        lines.push("  Everything responds. Empty results really mean empty data.");
      } else if (googleDown.length === googleProbes.length && failed.size === googleDown.length) {
        lines.push(
          "  Every Google-backed endpoint fails and everything else works, so the Google",
          "  authorisation is the common cause: an expired or revoked refresh token, or the",
          "  Calendar/Tasks APIs disabled in the Cloud project.",
          `  Re-authorise at ${config.url}/oauth/login, granting BOTH Calendar and Tasks.`,
          "  The container logs carry the exact Google error (Hono logs the stack on 500).",
        );
      } else if (googleDown.length > 0) {
        lines.push(
          `  Failing: ${[...failed].join(", ")}.`,
          "  Only part of the Google surface is down, which usually means a scope was not",
          "  granted or one of the two APIs is disabled in the Cloud project, rather than a",
          "  dead token. Check the container logs for the Google error code.",
        );
      } else {
        lines.push(`  Failing: ${[...failed].join(", ")}. Not a Google problem — check the container logs.`);
      }

      if (statusBody?.google === true && googleDown.length > 0) {
        lines.push(
          "",
          "  Careful: /api/status reports google:true, but that flag only checks that a token",
          "  row exists in the database — it says nothing about whether the token still works.",
        );
      }

      return text(lines.join("\n"), failed.size > 0);
    },
  );

  const ACTIONS_DOC =
    "Each action is { tool, args }.\n" +
    "- create_event: { title, start, end, rrule?, description? }. Times are ISO 8601 in the " +
    "instance timezone, e.g. \"2026-08-20T20:30:00\". rrule repeats it, e.g. " +
    "\"RRULE:FREQ=WEEKLY;BYDAY=TH\".\n" +
    "- update_event: { event_id, title?, start?, end?, rrule?, description? }. Only the fields " +
    "you pass change.\n" +
    "- delete_event: { event_id, title?, start?, series? }.\n\n" +
    "event_id must come from the `events` tool. Passing an occurrence id (the one with the " +
    "_20260820T… suffix) touches that single occurrence; passing the seriesId touches the whole " +
    "recurring series, including occurrences already in the past.";

  const actionsShape = {
    actions: z
      .array(
        z.object({
          tool: z.enum(["create_event", "update_event", "delete_event"]),
          args: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(50)
      .describe("The changes to make, in any order — the server sorts them."),
  };

  interface PlanResponse {
    applied: boolean;
    blocked: boolean;
    rendered: string;
    issues: { index: number; level: string; text: string }[];
    reason?: string;
    hint?: string;
    renderedResults?: string;
  }

  const renderPlanResponse = (r: Fetched<PlanResponse>, what: string): CallToolResult => {
    if (!r.ok) return present(what, r);
    const p = r.data;
    const out = [p.rendered];
    if (p.applied) {
      out.push("", p.renderedResults ?? "(applied, no result detail)");
    } else if (p.blocked) {
      out.push(
        "",
        `NOT APPLIED — ${p.reason === "errors" ? "the plan has errors" : "the plan has warnings"}.`,
        p.hint ?? "",
      );
    } else {
      out.push("", "Preview only — nothing was written. Call apply_changes to execute it.");
    }
    return text(out.join("\n"), p.blocked);
  };

  server.registerTool(
    "preview_changes",
    {
      description:
        "Dry run: validates calendar changes against the real calendar and returns the plan with " +
        "any problems found (stale ids, end before start, actions repeated inside the plan, exact " +
        "duplicates, overlaps). Writes nothing, ever. Always run this before apply_changes.\n\n" +
        ACTIONS_DOC,
      inputSchema: actionsShape,
    },
    async ({ actions }) =>
      renderPlanResponse(
        await client.post<PlanResponse>("/api/calendar/plan", { actions, apply: false }),
        "POST /api/calendar/plan (preview)",
      ),
  );

  server.registerTool(
    "apply_changes",
    {
      description:
        "Applies calendar changes for real. The server re-validates first and refuses the whole " +
        "plan if anything is wrong — nothing is half-applied on a validation failure. Warnings " +
        "(overlaps, an identical event already there) also refuse the plan unless " +
        "acknowledgeWarnings is true, so read them before forcing. Creating an event identical to " +
        "an existing one is skipped rather than duplicated, and deleting something already gone is " +
        "reported as such.\n\n" +
        ACTIONS_DOC,
      inputSchema: {
        ...actionsShape,
        acknowledgeWarnings: z
          .boolean()
          .optional()
          .describe("Apply despite warnings. Only after showing them to the user."),
      },
    },
    async ({ actions, acknowledgeWarnings }) =>
      renderPlanResponse(
        await client.post<PlanResponse>("/api/calendar/plan", {
          actions,
          apply: true,
          acknowledgeWarnings: acknowledgeWarnings ?? false,
        }),
        "POST /api/calendar/plan (apply)",
      ),
  );

  return server;
}

void serveStdio(createServer);
console.error(`roganizo MCP server on stdio → ${config.url}`);
