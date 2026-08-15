import { desc, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "../../db/index.js";
import { config } from "../../config.js";
import * as calendar from "../../google/calendar.js";
import * as gtasks from "../../google/tasks.js";
import type { PlanAction } from "../plan.js";

/** Definitions in the OpenAI tools format (what OpenRouter expects). */
export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_events",
      description:
        "Lista los eventos del calendario entre dos fechas (ISO 8601, hora local). Usalo antes de crear eventos relativos a otros ('después de X') y para responder qué hay agendado.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Inicio del rango, ISO 8601" },
          to: { type: "string", description: "Fin del rango, ISO 8601" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description:
        "PROPONE crear un evento en Google Calendar: NO lo crea, lo deja en una tarjeta que el usuario confirma con un botón. Antes de llamarla tenés que haber leído ese día con get_events o find_free_slots EN ESTE MISMO TURNO (si no, la tool falla). Para horarios semanales usá rrule (ej: 'RRULE:FREQ=WEEKLY;BYDAY=MO').",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "Inicio ISO 8601 hora local" },
          end: { type: "string", description: "Fin ISO 8601 hora local" },
          rrule: { type: "string", description: "Regla RRULE opcional para repetición" },
          description: { type: "string" },
          allow_overlap: { type: "boolean", description: "Crear aunque haya conflicto" },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "PROPONE modificar un evento existente (obtené el event_id con get_events en este mismo turno). No se aplica hasta que el usuario confirme con el botón. Para mover algo de horario esta es la tool correcta: NO borres y vuelvas a crear.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          rrule: { type: "string" },
          description: { type: "string" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description:
        "PROPONE borrar un evento del calendario. El event_id tiene que venir de un get_events o find_duplicate_events de ESTE turno: si es viejo o inventado, la tool falla. No se borra nada hasta que el usuario confirme con el botón.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          title: { type: "string", description: "Título del evento (para mostrar en la confirmación)" },
          start: { type: "string", description: "Inicio del evento, para mostrarlo en la confirmación" },
          series: {
            type: "boolean",
            description:
              "true si el id es de una serie repetida completa (borra todas sus repeticiones). Copialo de find_duplicate_events.",
          },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_free_slots",
      description:
        "Devuelve los huecos libres de un día (entre 08:00 y 22:00 por defecto). Usalo para sugerir horarios de estudio.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha ISO 8601 (YYYY-MM-DD)" },
          min_minutes: { type: "number", description: "Duración mínima del hueco (default 30)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_batch",
      description:
        "Propone varios cambios de calendario de una vez (ej: cargar un horario completo o limpiar duplicados). Preferila a llamar create_event/update_event/delete_event uno por uno: el usuario ve UNA sola tarjeta con todo y confirma una vez. Nada se ejecuta hasta que confirme.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Una frase corta explicando el objetivo del plan (el detalle lo arma el sistema)",
          },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: ["create_event", "update_event", "delete_event"] },
                args: { type: "object" },
              },
              required: ["tool", "args"],
            },
          },
        },
        required: ["summary", "actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_duplicate_events",
      description:
        "Busca eventos repetidos (mismo título y mismo horario exacto) en un rango. Devuelve, para cada repetición, qué ids hay que borrar para que quede una sola copia. Usalo cuando el usuario diga que hay cosas duplicadas o que el calendario está desordenado, y después pasá esos ids a propose_batch como delete_event.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Inicio del rango, ISO 8601" },
          to: { type: "string", description: "Fin del rango, ISO 8601" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Lista los to-dos de Google Tasks.",
      parameters: {
        type: "object",
        properties: {
          show_completed: { type: "boolean", description: "Incluir completadas (default false)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Crea un to-do en Google Tasks. Para prioridad usá el campo notes con formato 'Prioridad: Alta|Media|Baja' en la primera línea, seguido de la descripción.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          due_date: { type: "string", description: "Fecha límite YYYY-MM-DD (opcional)" },
          notes: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Marca un to-do como completado.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Borra un to-do. Requiere confirmación por botones (resultado pending).",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          title: { type: "string", description: "Título (para la confirmación)" },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description: "Guarda una nota.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notes",
      description: "Lista las notas guardadas (id, título, fecha).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_note",
      description: "Devuelve una nota completa por id.",
      parameters: {
        type: "object",
        properties: { note_id: { type: "number" } },
        required: ["note_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description: "Edita una nota existente.",
      parameters: {
        type: "object",
        properties: {
          note_id: { type: "number" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["note_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Borra una nota. Requiere confirmación por botones (resultado pending).",
      parameters: {
        type: "object",
        properties: {
          note_id: { type: "number" },
          title: { type: "string", description: "Título (para la confirmación)" },
        },
        required: ["note_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description:
        "Programa un recordatorio que el bot mandará por Telegram. Normal: un mensaje a la hora exacta (fire_at). Con urgent=true, fire_at es la HORA OBJETIVO: un aviso con botón 'Visto' 5 minutos antes y, si el usuario no confirma, llamada telefónica a la hora exacta.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Texto del recordatorio" },
          fire_at: { type: "string", description: "Fecha/hora ISO 8601 hora local" },
          urgent: {
            type: "boolean",
            description:
              "true solo si el usuario pide insistencia ('urgente', 'insiste hasta que confirme', 'llámame si no contesto')",
          },
        },
        required: ["message", "fire_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "Lista los recordatorios pendientes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_reminder",
      description: "Borra un recordatorio pendiente. Requiere confirmación por botones (resultado pending).",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "number" },
          message: { type: "string", description: "Texto (para la confirmación)" },
        },
        required: ["reminder_id"],
      },
    },
  },
] as const;

export interface PendingRequest {
  id: number;
  summary: string;
  /** Cards retired by this one; their Telegram messages get marked as replaced. */
  supersededIds: number[];
  /** Validation found errors: the card is informative, Confirm will refuse. */
  blocked: boolean;
}

/** Tools that change something. If the model says "done" without calling one, it lied. */
export const MUTATING_TOOLS = new Set([
  "create_event",
  "update_event",
  "delete_event",
  "propose_batch",
  "create_task",
  "complete_task",
  "delete_task",
  "create_note",
  "update_note",
  "delete_note",
  "create_reminder",
  "delete_reminder",
]);

/** Everything that touches Google Calendar always goes through a confirmation. */
const CALENDAR_WRITES = new Set(["create_event", "update_event", "delete_event"]);

/** Low-stakes and easy to undo: these run right away, no card needed. */
const IMMEDIATE_TOOLS = new Set([
  "create_task",
  "complete_task",
  "create_note",
  "update_note",
  "create_reminder",
]);

export interface ToolContext {
  /** true while running a batch the user already confirmed */
  confirmed?: boolean;
  /** mutating tools called this turn, whether they ran or were only staged */
  mutated?: string[];
  /** mutating tools that really changed something (nothing staged is here) */
  executed?: string[];
  /** calendar changes proposed in this turn, merged into a single card at the end */
  staged?: PlanAction[];
  /** set once the plan is final: further staging would duplicate it */
  planFrozen?: boolean;
  /** days already read in this turn (YYYY-MM-DD), for the read-before-write rule */
  readDays?: Set<string>;
  /** event ids seen in this turn, so stale/invented ids cannot be used */
  knownEventIds?: Set<string>;
}

const now = () => new Date().toISOString();

/** Returned once the turn's plan is closed, so a retry cannot double it up. */
const PLAN_FROZEN = {
  error:
    "El plan de este turno ya está cerrado y el usuario lo va a ver tal cual. No agregues más acciones: " +
    "respondé solo con texto. Si falta algo, se lo decís y lo hacés en el próximo mensaje.",
};

const dayOf = (iso: unknown) =>
  DateTime.fromISO(String(iso ?? ""), { zone: config.TIMEZONE }).toISODate() ?? "";

/** Remembers what the model has actually looked at, so writes can require it. */
function rememberRead(ctx: ToolContext, events: calendar.EventSummary[], fromISO: string, toISO: string) {
  ctx.readDays ??= new Set();
  ctx.knownEventIds ??= new Set();
  let cursor = DateTime.fromISO(fromISO, { zone: config.TIMEZONE }).startOf("day");
  const end = DateTime.fromISO(toISO, { zone: config.TIMEZONE }).endOf("day");
  // Guard against a nonsense range asking for thousands of iterations.
  for (let i = 0; cursor <= end && i < 400; i++, cursor = cursor.plus({ days: 1 })) {
    ctx.readDays.add(cursor.toISODate()!);
  }
  for (const ev of events) {
    ctx.knownEventIds.add(ev.id);
    if (ev.seriesId) ctx.knownEventIds.add(ev.seriesId);
  }
}

/**
 * Stages a calendar change instead of running it. The whole turn produces ONE
 * confirmation card (see agent.ts), which is what stops the user from having
 * several live versions of the same plan and confirming them all.
 */
function stage(ctx: ToolContext, action: PlanAction) {
  if (ctx.planFrozen) return PLAN_FROZEN;
  (ctx.staged ??= []).push(action);
  return {
    staged: true,
    position: ctx.staged.length,
    message:
      "Anotado en el plan. NO está hecho: al final del turno el usuario verá una sola tarjeta con todo y tendrá que confirmar. " +
      "No digas que ya lo hiciste; decile qué vas a hacer y que confirme con el botón.",
  };
}

/** Read-before-write: refuses to plan a change on a day the model has not read. */
function requireRead(ctx: ToolContext, isoDates: unknown[]): { error: string } | null {
  const missing = isoDates
    .map(dayOf)
    .filter((d) => d && !(ctx.readDays?.has(d) ?? false));
  if (missing.length === 0) return null;
  return {
    error:
      `Todavía no leíste el calendario de ${[...new Set(missing)].join(", ")} en este turno. ` +
      "Llamá primero a get_events (o find_free_slots) de esos días y después volvé a proponer el cambio.",
  };
}

/** Refuses ids the model did not obtain from a read in this same turn. */
function requireKnownId(ctx: ToolContext, id: string): { error: string } | null {
  if (ctx.knownEventIds?.has(id)) return null;
  return {
    error:
      `El id "${id}" no salió de ninguna lectura de este turno, así que puede ser viejo o inventado. ` +
      "Llamá a get_events del día correspondiente (o find_duplicate_events) y usá el id que devuelva.",
  };
}

/** Runs a tool. Calendar writes are staged for confirmation unless ctx.confirmed. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  if (MUTATING_TOOLS.has(name)) {
    (ctx.mutated ??= []).push(name);
    if (ctx.confirmed || IMMEDIATE_TOOLS.has(name)) (ctx.executed ??= []).push(name);
  }
  switch (name) {
    case "get_events": {
      const events = await calendar.listEvents(String(args.from), String(args.to));
      rememberRead(ctx, events, String(args.from), String(args.to));
      return events;
    }

    case "create_event": {
      if (!ctx.confirmed) {
        const blocked = requireRead(ctx, [args.start]);
        if (blocked) return blocked;
        return stage(ctx, { tool: "create_event", args });
      }
      // Confirmed run: never produce a byte-identical twin, even if the user
      // confirmed the same plan twice.
      const duplicate = await calendar.findExactDuplicate(
        String(args.title),
        String(args.start),
        String(args.end),
      );
      if (duplicate) return { skipped_duplicate: true, existing_id: duplicate.id };
      return calendar.createEvent({
        title: String(args.title),
        startISO: String(args.start),
        endISO: String(args.end),
        rrule: args.rrule ? String(args.rrule) : undefined,
        description: args.description ? String(args.description) : undefined,
      });
    }

    case "update_event": {
      const eventId = String(args.event_id ?? "");
      if (!ctx.confirmed) {
        const unknown = requireKnownId(ctx, eventId);
        if (unknown) return unknown;
        if (args.start) {
          const blocked = requireRead(ctx, [args.start]);
          if (blocked) return blocked;
        }
        return stage(ctx, { tool: "update_event", args });
      }
      if (!(await calendar.getEvent(eventId))) return { gone: true };
      return calendar.updateEvent(eventId, {
        title: args.title as string | undefined,
        startISO: args.start as string | undefined,
        endISO: args.end as string | undefined,
        rrule: args.rrule as string | undefined,
        description: args.description as string | undefined,
      });
    }

    case "delete_event": {
      const eventId = String(args.event_id ?? "");
      if (!ctx.confirmed) {
        const unknown = requireKnownId(ctx, eventId);
        if (unknown) return unknown;
        return stage(ctx, { tool: "delete_event", args });
      }
      if (!(await calendar.getEvent(eventId))) return { gone: true };
      await calendar.deleteEvent(eventId);
      return { deleted: true };
    }

    case "find_free_slots": {
      const date = String(args.date);
      const slots = await calendar.findFreeSlots(date, args.min_minutes ? Number(args.min_minutes) : 30);
      // The day was inspected, but no ids came back: only creates are unlocked.
      const day = DateTime.fromISO(date, { zone: config.TIMEZONE });
      if (day.isValid) (ctx.readDays ??= new Set()).add(day.toISODate()!);
      return slots;
    }

    case "find_duplicate_events": {
      const report = await calendar.findDuplicates(String(args.from), String(args.to));
      rememberRead(ctx, report.groups.flatMap((g) => g.copies), String(args.from), String(args.to));
      for (const d of report.deletions) ctx.knownEventIds!.add(d.id);
      return {
        duplicated_groups: report.groups.length,
        // Shaped so each entry can be copied straight into a delete_event action.
        delete_these: report.deletions.map((d) => ({
          event_id: d.id,
          title: d.title,
          start: d.when,
          series: d.kind === "series",
        })),
        message: report.deletions.length
          ? "Copiá cada entrada de delete_these como args de un delete_event dentro de propose_batch (incluí 'series' tal cual): " +
            "así queda una sola copia de cada cosa. series=true borra la repetición completa."
          : "No hay duplicados en ese rango.",
      };
    }

    case "propose_batch": {
      if (ctx.planFrozen) return PLAN_FROZEN;
      const actions = (args.actions ?? []) as PlanAction[];
      if (!Array.isArray(actions) || actions.length === 0) {
        return { error: "propose_batch necesita al menos una acción en 'actions'." };
      }
      for (const action of actions) {
        if (!CALENDAR_WRITES.has(action.tool)) {
          return { error: `propose_batch solo acepta create_event, update_event y delete_event (vino "${action.tool}").` };
        }
        if (action.tool === "create_event") {
          const blocked = requireRead(ctx, [action.args?.start]);
          if (blocked) return blocked;
        } else {
          const unknown = requireKnownId(ctx, String(action.args?.event_id ?? ""));
          if (unknown) return unknown;
        }
      }
      (ctx.staged ??= []).push(...actions);
      return {
        staged: true,
        count: actions.length,
        message:
          "Plan anotado. NO está hecho: el usuario verá una sola tarjeta con el detalle y tendrá que confirmar.",
      };
    }

    case "list_tasks":
      return gtasks.listTasks(Boolean(args.show_completed));

    case "create_task":
      return gtasks.createTask(
        String(args.title),
        args.due_date ? String(args.due_date) : undefined,
        args.notes ? String(args.notes) : undefined,
      );

    case "complete_task":
      await gtasks.completeTask(String(args.task_id));
      return { completed: true };

    case "delete_task": {
      if (!ctx.confirmed) return stage(ctx, { tool: "delete_task", args });
      await gtasks.deleteTask(String(args.task_id));
      return { deleted: true };
    }

    case "create_note": {
      const t = now();
      return db
        .insert(schema.notes)
        .values({ title: String(args.title), body: String(args.body), createdAt: t, updatedAt: t })
        .returning()
        .get();
    }

    case "list_notes":
      return db
        .select({
          id: schema.notes.id,
          title: schema.notes.title,
          createdAt: schema.notes.createdAt,
        })
        .from(schema.notes)
        .orderBy(desc(schema.notes.updatedAt))
        .all();

    case "get_note":
      return (
        db.select().from(schema.notes).where(eq(schema.notes.id, Number(args.note_id))).get() ??
        { error: "No existe una nota con ese id" }
      );

    case "update_note": {
      const set: Record<string, string> = { updatedAt: now() };
      if (args.title !== undefined) set.title = String(args.title);
      if (args.body !== undefined) set.body = String(args.body);
      const updated = db
        .update(schema.notes)
        .set(set)
        .where(eq(schema.notes.id, Number(args.note_id)))
        .returning()
        .get();
      return updated ?? { error: "No existe una nota con ese id" };
    }

    case "delete_note": {
      if (!ctx.confirmed) return stage(ctx, { tool: "delete_note", args });
      db.delete(schema.notes).where(eq(schema.notes.id, Number(args.note_id))).run();
      return { deleted: true };
    }

    case "create_reminder": {
      const fireAt = DateTime.fromISO(String(args.fire_at), { zone: config.TIMEZONE });
      if (!fireAt.isValid) return { error: "fire_at inválido, usá ISO 8601" };
      return db
        .insert(schema.reminders)
        .values({
          message: String(args.message),
          fireAt: fireAt.toISO()!,
          createdAt: now(),
          urgent: args.urgent ? 1 : 0,
        })
        .returning()
        .get();
    }

    case "list_reminders":
      return db
        .select()
        .from(schema.reminders)
        .where(isNull(schema.reminders.firedAt))
        .orderBy(schema.reminders.fireAt)
        .all();

    case "delete_reminder": {
      if (!ctx.confirmed) return stage(ctx, { tool: "delete_reminder", args });
      db.delete(schema.reminders)
        .where(eq(schema.reminders.id, Number(args.reminder_id)))
        .run();
      return { deleted: true };
    }

    default:
      return { error: `Tool desconocida: ${name}` };
  }
}
