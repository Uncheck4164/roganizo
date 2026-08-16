import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "./auth.js";
import {
  describeAction,
  hasErrors,
  renderPlan,
  renderResults,
  sortPlan,
  validatePlan,
  type ActionResult,
  type PlanAction,
} from "../agent/plan.js";
import { executeTool } from "../agent/tools/index.js";

/**
 * The one write surface of the HTTP API, used by the MCP server. Everything
 * else under /api is GET.
 *
 * It deliberately runs the *same* validation the Telegram confirmation card
 * runs — stale ids, times that end before they start, actions repeated inside
 * the plan, exact duplicates and overlaps — and the same executor, so a change
 * made from here behaves exactly like one made from a confirmed card. What it
 * does not have is the human tapping Confirm, so warnings block by default and
 * the caller has to acknowledge them explicitly.
 */
export const calendarWriteRoutes = new Hono();

const bodySchema = z.object({
  actions: z
    .array(
      z.object({
        tool: z.enum(["create_event", "update_event", "delete_event"]),
        args: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(50),
  apply: z.boolean().default(false),
  acknowledgeWarnings: z.boolean().default(false),
});

calendarWriteRoutes.use("/api/calendar/*", requireSession);

calendarWriteRoutes.post("/api/calendar/plan", async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }
  const { apply, acknowledgeWarnings } = parsed.data;

  // Deletes and moves before creates, so a slot freed by this same plan is
  // actually free when something is created in it.
  const actions = sortPlan(parsed.data.actions as PlanAction[]);
  // Note: validatePlan fills missing titles and times from the real event, so
  // the labels below describe what is really being touched, not what was typed.
  const issues = await validatePlan(actions);

  const errors = hasErrors(issues);
  const warnings = issues.filter((i) => i.level === "warning");
  const blocked = errors || (warnings.length > 0 && !acknowledgeWarnings);

  const plan = {
    actions: actions.map((a, index) => ({
      index,
      tool: a.tool,
      args: a.args,
      label: describeAction(a),
    })),
    issues,
    rendered: renderPlan(actions, issues),
    blocked,
  };

  if (!apply) return c.json({ ...plan, applied: false });

  if (blocked) {
    return c.json(
      {
        ...plan,
        applied: false,
        reason: errors ? "errors" : "warnings",
        hint: errors
          ? "Fix the errors: nothing was applied."
          : "Re-send with acknowledgeWarnings: true if the warnings are expected.",
      },
      422,
    );
  }

  // Same executor as a confirmed card: create_event skips a byte-identical
  // twin, update/delete report an event that is already gone instead of
  // failing, so replaying this request cannot duplicate anything.
  const results: ActionResult[] = [];
  for (const [index, action] of actions.entries()) {
    const label = describeAction(action);
    try {
      const result = (await executeTool(action.tool, action.args, { confirmed: true })) as Record<
        string,
        unknown
      >;
      if (result?.skipped_duplicate) results.push({ index, outcome: "skipped_duplicate", label });
      else if (result?.gone) results.push({ index, outcome: "gone", label });
      else if (result?.conflict) results.push({ index, outcome: "conflict", label });
      else if (action.tool === "delete_event") results.push({ index, outcome: "deleted", label });
      else if (action.tool === "update_event") results.push({ index, outcome: "updated", label });
      else results.push({ index, outcome: "created", label });
    } catch (err) {
      results.push({ index, outcome: "failed", label, detail: (err as Error).message });
    }
  }

  return c.json({ ...plan, applied: true, results, renderedResults: renderResults(results) });
});
