import { getDb } from "@/lib/db";
import {
  type GpuMode,
  type SchedulerSnapshot,
  type TaskGroup,
  type TaskGroupPayloadMap,
  type TaskQueueSnapshot,
  type TaskGroupResultMap,
  type TaskGroupStatus,
  type TaskGroupType,
} from "@/lib/tasks/types";

type TaskRow = {
  id: string;
  type: TaskGroupType;
  status: TaskGroupStatus;
  payload_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type RuntimeStateRow = {
  active_task_id: string | null;
  gpu_mode: GpuMode;
  last_error: string | null;
};

const db = getDb();
type TaskGroupOfType<TType extends TaskGroupType> = Extract<
  TaskGroup,
  { type: TType }
>;

const cloneJson = <TValue>(value: TValue): TValue => {
  return JSON.parse(JSON.stringify(value)) as TValue;
};

const cloneTask = <TTask extends TaskGroup>(task: TTask): TTask => {
  return {
    ...task,
    payload: cloneJson(task.payload),
    result: task.result ? cloneJson(task.result) : null,
  } as TTask;
};

const parseJson = <TValue>(value: string | null, fallback: TValue): TValue => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as TValue;
  } catch {
    return fallback;
  }
};

const rowToTask = (row: TaskRow): TaskGroup => {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    payload: parseJson(row.payload_json, {}) as TaskGroupPayloadMap[TaskGroupType],
    result: parseJson(row.result_json, null) as TaskGroupResultMap[TaskGroupType] | null,
  } as TaskGroup;
};

const getRuntimeState = (): RuntimeStateRow => {
  const state = db
    .prepare(
      `
        SELECT active_task_id, gpu_mode, last_error
        FROM task_runtime_state
        WHERE singleton_id = 1
      `,
    )
    .get() as RuntimeStateRow | undefined;

  return (
    state ?? {
      active_task_id: null,
      gpu_mode: "chat",
      last_error: null,
    }
  );
};

const listTasksByStatus = <TType extends TaskGroupType>(
  type: TType,
  status: TaskGroupStatus,
) => {
  const rows = db
    .prepare(
      `
        SELECT
          id,
          type,
          status,
          payload_json,
          result_json,
          error,
          created_at,
          started_at,
          finished_at
        FROM tasks
        WHERE type = ? AND status = ?
        ORDER BY created_at ASC
      `,
    )
    .all(type, status) as TaskRow[];

  return rows.map((row) => rowToTask(row) as TaskGroupOfType<TType>);
};

export const createTask = <TType extends TaskGroupType>(
  type: TType,
  payload: TaskGroupPayloadMap[TType],
) => {
  const task: TaskGroup = {
    id: crypto.randomUUID(),
    type,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload,
    result: null,
  } as TaskGroup;

  db.prepare(
    `
      INSERT INTO tasks (
        id,
        type,
        status,
        payload_json,
        result_json,
        error,
        created_at,
        started_at,
        finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    task.id,
    task.type,
    task.status,
    JSON.stringify(task.payload),
    null,
    task.error,
    task.createdAt,
    task.startedAt,
    task.finishedAt,
  );

  return cloneTask(task);
};

export const getTask = (taskId: string) => {
  const row = db
    .prepare(
      `
        SELECT
          id,
          type,
          status,
          payload_json,
          result_json,
          error,
          created_at,
          started_at,
          finished_at
        FROM tasks
        WHERE id = ?
      `,
    )
    .get(taskId) as TaskRow | undefined;

  return row ? cloneTask(rowToTask(row)) : null;
};

export const listQueuedTasks = <TType extends TaskGroupType>(type: TType) => {
  return listTasksByStatus(type, "queued").map((task) => cloneTask(task));
};

export const listAllTasks = () => {
  const rows = db
    .prepare(
      `
        SELECT
          id,
          type,
          status,
          payload_json,
          result_json,
          error,
          created_at,
          started_at,
          finished_at
        FROM tasks
        ORDER BY created_at ASC
      `,
    )
    .all() as TaskRow[];

  return rows.map((row) => cloneTask(rowToTask(row)));
};

export const updateTaskStatus = (
  taskId: string,
  input: {
    status?: TaskGroupStatus;
    error?: string | null;
    result?: TaskGroupResultMap[TaskGroupType] | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  },
) => {
  const existing = getTask(taskId);
  if (!existing) return null;

  const nextTask: TaskGroup = {
    ...existing,
    status: input.status ?? existing.status,
    error: input.error !== undefined ? input.error : existing.error,
    result:
      input.result !== undefined
        ? (input.result as TaskGroup["result"])
        : existing.result,
    startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
    finishedAt: input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
  } as TaskGroup;

  db.prepare(
    `
      UPDATE tasks
      SET
        status = ?,
        result_json = ?,
        error = ?,
        started_at = ?,
        finished_at = ?
      WHERE id = ?
    `,
  ).run(
    nextTask.status,
    nextTask.result ? JSON.stringify(nextTask.result) : null,
    nextTask.error,
    nextTask.startedAt,
    nextTask.finishedAt,
    taskId,
  );

  return cloneTask(nextTask);
};

export const updateTaskPayload = (
  taskId: string,
  payload: TaskGroupPayloadMap[TaskGroupType],
) => {
  const existing = getTask(taskId);
  if (!existing) return null;

  const nextTask: TaskGroup = {
    ...existing,
    payload,
  } as TaskGroup;

  db.prepare(
    `
      UPDATE tasks
      SET payload_json = ?
      WHERE id = ?
    `,
  ).run(JSON.stringify(payload), taskId);

  return cloneTask(nextTask);
};

export const dequeueTask = (_taskId?: string) => {
  // Queue membership is derived from persisted task status.
};

export const setActiveTaskId = (taskId: string | null) => {
  db.prepare(
    `
      UPDATE task_runtime_state
      SET active_task_id = ?
      WHERE singleton_id = 1
    `,
  ).run(taskId);
};

export const setGpuMode = (gpuMode: GpuMode) => {
  db.prepare(
    `
      UPDATE task_runtime_state
      SET gpu_mode = ?
      WHERE singleton_id = 1
    `,
  ).run(gpuMode);
};

export const setSchedulerLastError = (error: string | null) => {
  db.prepare(
    `
      UPDATE task_runtime_state
      SET last_error = ?
      WHERE singleton_id = 1
    `,
  ).run(error);
};

export const getSchedulerLastError = () => {
  return getRuntimeState().last_error;
};

export const attachComfyJobToTask = (jobId: string, taskId: string) => {
  db.prepare(
    `
      INSERT INTO comfy_task_jobs (job_id, task_id)
      VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET task_id = excluded.task_id
    `,
  ).run(jobId, taskId);
};

export const getTaskIdForComfyJob = (jobId: string) => {
  const row = db
    .prepare(`SELECT task_id FROM comfy_task_jobs WHERE job_id = ?`)
    .get(jobId) as { task_id: string } | undefined;

  return row?.task_id ?? null;
};

export const detachComfyJob = (jobId: string) => {
  db.prepare(`DELETE FROM comfy_task_jobs WHERE job_id = ?`).run(jobId);
};

export const getSchedulerSnapshot = (): SchedulerSnapshot => {
  const state = getRuntimeState();
  const queues: TaskQueueSnapshot = {
    chat: listTasksByStatus("chat", "queued"),
    comfy: listTasksByStatus("comfy", "queued"),
  };

  return {
    gpuMode: state.gpu_mode,
    activeTaskId: state.active_task_id,
    queues,
  };
};

export const resetTaskStore = () => {
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM comfy_task_jobs`).run();
    db.prepare(`DELETE FROM tasks`).run();
    db.prepare(
      `
        UPDATE task_runtime_state
        SET active_task_id = NULL, gpu_mode = 'chat', last_error = NULL
        WHERE singleton_id = 1
      `,
    ).run();
  });

  transaction();
};
