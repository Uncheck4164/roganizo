import { google } from "googleapis";
import { DateTime } from "luxon";
import { getAuthedClient } from "./auth.js";
import { config } from "../config.js";

function api() {
  return google.tasks({ version: "v1", auth: getAuthedClient() });
}

export interface TaskSummary {
  id: string;
  title: string;
  notes?: string;
  due?: string; // ISO date
  completed: boolean;
}

export async function listTasks(showCompleted = true): Promise<TaskSummary[]> {
  const res = await api().tasks.list({
    tasklist: "@default",
    showCompleted,
    showHidden: showCompleted,
    maxResults: 100,
  });
  return (res.data.items ?? []).map((t) => ({
    id: t.id ?? "",
    title: t.title ?? "",
    notes: t.notes ?? undefined,
    due: t.due ?? undefined,
    completed: t.status === "completed",
  }));
}

export async function createTask(
  title: string,
  dueDateISO?: string,
  notes?: string,
): Promise<TaskSummary> {
  const res = await api().tasks.insert({
    tasklist: "@default",
    requestBody: {
      title,
      notes,
      // Google Tasks solo respeta la fecha (no la hora) del campo due
      due: dueDateISO
        ? DateTime.fromISO(dueDateISO, { zone: config.TIMEZONE }).toUTC().toISO()!
        : undefined,
    },
  });
  return {
    id: res.data.id ?? "",
    title: res.data.title ?? "",
    notes: res.data.notes ?? undefined,
    due: res.data.due ?? undefined,
    completed: false,
  };
}

export async function completeTask(taskId: string): Promise<void> {
  await api().tasks.patch({
    tasklist: "@default",
    task: taskId,
    requestBody: { status: "completed" },
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  await api().tasks.delete({ tasklist: "@default", task: taskId });
}
