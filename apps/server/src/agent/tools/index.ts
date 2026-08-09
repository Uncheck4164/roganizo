import { desc, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "../../db/index.js";
import { config } from "../../config.js";
import * as calendar from "../../google/calendar.js";
import * as gtasks from "../../google/tasks.js";

/** Definiciones en formato OpenAI tools (lo que espera OpenRouter). */
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
        "Crea un evento en Google Calendar. Para horarios que se repiten cada semana usá rrule (ej: 'RRULE:FREQ=WEEKLY;BYDAY=MO'). Verifica conflictos de horario: si hay solape devuelve conflict=true y NO crea; avisale al usuario y sugerí alternativa. Solo repetí con allow_overlap=true si el usuario insiste.",
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
      description: "Modifica un evento existente (obtené el event_id con get_events).",
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
        "Borra un evento del calendario. Requiere confirmación del usuario por botones: el resultado será pending y el usuario debe tocar Confirmar.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          title: { type: "string", description: "Título del evento (para mostrar en la confirmación)" },
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
        "OBLIGATORIO cuando vas a crear 3 o más eventos de una vez (ej: cargar un horario completo): en lugar de llamar create_event repetidamente, pasá acá la lista completa. El usuario verá un resumen con botones Confirmar/Cancelar y las acciones se ejecutan solo si confirma.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Resumen legible de lo que se va a crear, una línea por evento",
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
}

/** Tools que cambian algo. Si el modelo dice "listo" sin haber llamado ninguna, mintió. */
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

export interface ToolContext {
  /** true cuando se está ejecutando un batch ya confirmado por el usuario */
  confirmed?: boolean;
  /** confirmaciones creadas durante el run del agente (el bot les pone botones) */
  pending: PendingRequest[];
  /** nombres de tools mutantes efectivamente ejecutadas en este turno */
  mutated?: string[];
}

const now = () => new Date().toISOString();

function createPending(ctx: ToolContext, summary: string, actions: { tool: string; args: unknown }[]) {
  const row = db
    .insert(schema.pendingActions)
    .values({ actionsJson: JSON.stringify(actions), summary, createdAt: now() })
    .returning()
    .get();
  ctx.pending.push({ id: row.id, summary });
  return {
    pending: true,
    pending_id: row.id,
    message:
      "Acción en espera de confirmación: el usuario verá botones Confirmar/Cancelar. No asumas que se ejecutó.",
  };
}

/** Ejecuta una tool. Las destructivas se desvían a pending_actions salvo ctx.confirmed. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  if (MUTATING_TOOLS.has(name)) (ctx.mutated ??= []).push(name);
  switch (name) {
    case "get_events":
      return calendar.listEvents(String(args.from), String(args.to));

    case "create_event": {
      // Un batch confirmado por botones ya fue aprobado por el usuario tal como
      // se resumió: no volver a bloquear por conflicto en la ejecución.
      if (!args.allow_overlap && !ctx.confirmed) {
        // Un evento recurrente nuevo se chequea solo contra su primera instancia
        const conflicts = await calendar.findConflicts(String(args.start), String(args.end));
        if (conflicts.length > 0) {
          return {
            conflict: true,
            message: "NO se creó el evento: se solapa con los siguientes. Avisá al usuario y sugerí otro horario (o repetí con allow_overlap=true si insiste).",
            conflicts,
          };
        }
      }
      return calendar.createEvent({
        title: String(args.title),
        startISO: String(args.start),
        endISO: String(args.end),
        rrule: args.rrule ? String(args.rrule) : undefined,
        description: args.description ? String(args.description) : undefined,
      });
    }

    case "update_event":
      return calendar.updateEvent(String(args.event_id), {
        title: args.title as string | undefined,
        startISO: args.start as string | undefined,
        endISO: args.end as string | undefined,
        rrule: args.rrule as string | undefined,
        description: args.description as string | undefined,
      });

    case "delete_event": {
      if (!ctx.confirmed) {
        return createPending(ctx, `🗑 Borrar evento: ${args.title ?? args.event_id}`, [
          { tool: "delete_event", args },
        ]);
      }
      await calendar.deleteEvent(String(args.event_id));
      return { deleted: true };
    }

    case "find_free_slots":
      return calendar.findFreeSlots(
        String(args.date),
        args.min_minutes ? Number(args.min_minutes) : 30,
      );

    case "propose_batch": {
      const actions = args.actions as { tool: string; args: Record<string, unknown> }[];
      return createPending(ctx, String(args.summary), actions);
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
      if (!ctx.confirmed) {
        return createPending(ctx, `🗑 Borrar to-do: ${args.title ?? args.task_id}`, [
          { tool: "delete_task", args },
        ]);
      }
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
      if (!ctx.confirmed) {
        return createPending(ctx, `🗑 Borrar nota: ${args.title ?? args.note_id}`, [
          { tool: "delete_note", args },
        ]);
      }
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
      if (!ctx.confirmed) {
        return createPending(ctx, `🗑 Borrar recordatorio: ${args.message ?? args.reminder_id}`, [
          { tool: "delete_reminder", args },
        ]);
      }
      db.delete(schema.reminders)
        .where(eq(schema.reminders.id, Number(args.reminder_id)))
        .run();
      return { deleted: true };
    }

    default:
      return { error: `Tool desconocida: ${name}` };
  }
}
