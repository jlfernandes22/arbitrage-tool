// lib/task-store.ts
// In-memory task state store (global singleton).
// Next.js API routes are request-scoped, but the dev server process is
// persistent, so a module-level Map survives across requests. Final results
// are also persisted to SQLite for durability.
//
// As of Phase 3, this store is a *write-through cache for active/running
// tasks only*. The history list (`/api/tasks/list`) reads from the Prisma
// SQLite `Task` table as the source of truth, so history survives restarts.
import type { TaskState, TaskResult, AppConfig, LogEntry, LogLevel } from "@/lib/engine/types";
const globalForTasks = globalThis as unknown as {
  __arbitrageTaskStore: Map<string, TaskState> | undefined;
};
const store: Map<string, TaskState> =
  globalForTasks.__arbitrageTaskStore ?? new Map();
globalForTasks.__arbitrageTaskStore = store;
// Cap logs to prevent unbounded memory growth during long pipelines.
const MAX_LOGS = 400;
export function getTask(id: string): TaskState | undefined {
  return store.get(id);
}
export function setTask(id: string, state: TaskState): void {
  store.set(id, state);
}
export function updateTask(
  id: string,
  patch: Partial<TaskState>,
): TaskState | undefined {
  const cur = store.get(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  store.set(id, next);
  return next;
}
/**
 * Append a log entry to a task's execution log (for the terminal console).
 * Caps the log array to MAX_LOGS entries (rolling window).
 */
export function appendLog(
  id: string,
  level: LogLevel,
  msg: string,
): void {
  const cur = store.get(id);
  if (!cur) return;
  const entry: LogEntry = { ts: Date.now(), level, msg };
  const logs = cur.logs ? [...cur.logs, entry] : [entry];
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  store.set(id, { ...cur, logs });
}
export function listTasks(): TaskState[] {
  return Array.from(store.values()).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
}
export function deleteTask(id: string): boolean {
  return store.delete(id);
}
/**
 * Mark a running task as cancellation-requested. The orchestrator polls
 * `isCancelRequested` at key checkpoints (between scrapers, before calc
 * phase) and bails out gracefully when this is true.
 */
export function requestCancel(id: string): boolean {
  const cur = store.get(id);
  if (!cur) return false;
  store.set(id, { ...cur, cancelRequested: true });
  return true;
}
/**
 * Check whether a cancel has been requested for a task. Returns false for
 * unknown tasks (treated as "no cancellation pending").
 */
export function isCancelRequested(id: string): boolean {
  return store.get(id)?.cancelRequested === true;
}
export type { TaskState, TaskResult, AppConfig, LogEntry, LogLevel };