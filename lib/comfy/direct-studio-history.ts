import { getDb } from "@/lib/db";
import { getTask } from "@/lib/tasks/store";
import type { WorkflowName } from "@/lib/comfy/workflows/types";

type DirectComfyHistoryRow = {
  id: string;
  task_id: string;
  workflow_name: WorkflowName;
  prompt: string;
  negative_prompt: string;
  input_image_json: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  sampler_name: string;
  scheduler: string;
  loras_json: string;
  reference_strength: number;
  created_at: string;
};

type GenerationImageRow = {
  position: number;
};

type LoraConfig = {
  name: string;
  strength_model: number;
  strength_clip: number;
};

export type DirectComfyHistoryParams = {
  workflowName: WorkflowName;
  prompt: string;
  negativePrompt: string;
  inputImage: string[];
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  samplerName: string;
  scheduler: string;
  loras: LoraConfig[];
  referenceStrength: number;
};

export type DirectComfyHistoryItem = {
  id: string;
  taskId: string;
  createdAt: string;
  params: DirectComfyHistoryParams;
  images: string[];
};

const db = getDb();

const parseJsonArray = <T>(value: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

export const upsertDirectComfyHistory = (input: {
  taskId: string;
  params: DirectComfyHistoryParams;
}) => {
  const timestamp = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO direct_comfy_history (
        id,
        task_id,
        workflow_name,
        prompt,
        negative_prompt,
        input_image_json,
        width,
        height,
        steps,
        cfg,
        seed,
        sampler_name,
        scheduler,
        loras_json,
        reference_strength,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        workflow_name = excluded.workflow_name,
        prompt = excluded.prompt,
        negative_prompt = excluded.negative_prompt,
        input_image_json = excluded.input_image_json,
        width = excluded.width,
        height = excluded.height,
        steps = excluded.steps,
        cfg = excluded.cfg,
        seed = excluded.seed,
        sampler_name = excluded.sampler_name,
        scheduler = excluded.scheduler,
        loras_json = excluded.loras_json,
        reference_strength = excluded.reference_strength,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.taskId,
    input.taskId,
    input.params.workflowName,
    input.params.prompt,
    input.params.negativePrompt,
    JSON.stringify(input.params.inputImage),
    input.params.width,
    input.params.height,
    input.params.steps,
    input.params.cfg,
    input.params.seed,
    input.params.samplerName,
    input.params.scheduler,
    JSON.stringify(input.params.loras),
    input.params.referenceStrength,
    timestamp,
    timestamp,
  );
};

export const listDirectComfyHistory = ({
  limit = 60,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}): DirectComfyHistoryItem[] => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 60;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const rows = db
    .prepare(
      `
        SELECT
          id,
          task_id,
          workflow_name,
          prompt,
          negative_prompt,
          input_image_json,
          width,
          height,
          steps,
          cfg,
          seed,
          sampler_name,
          scheduler,
          loras_json,
          reference_strength,
          created_at
        FROM direct_comfy_history
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `,
    )
    .all(safeLimit, safeOffset) as DirectComfyHistoryRow[];

  return rows.map((row) => {
    const task = getTask(row.task_id);
    const jobId = task?.type === "comfy" ? task.result?.jobId ?? null : null;
    const imageRows = jobId
      ? (db
          .prepare(
            `
              SELECT position
              FROM comfy_generation_images
              WHERE job_id = ?
              ORDER BY position ASC
            `,
          )
          .all(jobId) as GenerationImageRow[])
      : [];
    const images = imageRows.map(
      (image) => `/api/comfy/history-image?jobId=${encodeURIComponent(jobId!)}&index=${image.position}`,
    );

    const inputImage = parseJsonArray<string>(row.input_image_json, []).filter(
      (value) => typeof value === "string",
    );
    const loras = parseJsonArray<LoraConfig>(row.loras_json, []).filter(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        typeof item.strength_model === "number" &&
        typeof item.strength_clip === "number",
    );

    return {
      id: row.id,
      taskId: row.task_id,
      createdAt: row.created_at,
      params: {
        workflowName: row.workflow_name,
        prompt: row.prompt,
        negativePrompt: row.negative_prompt,
        inputImage,
        width: row.width,
        height: row.height,
        steps: row.steps,
        cfg: row.cfg,
        seed: row.seed,
        samplerName: row.sampler_name,
        scheduler: row.scheduler,
        loras,
        referenceStrength:
          typeof row.reference_strength === "number" && Number.isFinite(row.reference_strength)
            ? row.reference_strength
            : 0,
      },
      images,
    };
  });
};

export const countDirectComfyHistory = () => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM direct_comfy_history
      `,
    )
    .get() as { total?: number } | undefined;

  return Number.isFinite(row?.total ?? NaN) ? Number(row?.total) : 0;
};

export const deleteDirectComfyHistoryItem = (id: string) => {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return false;
  }

  const result = db
    .prepare(
      `
        DELETE FROM direct_comfy_history
        WHERE id = ?
      `,
    )
    .run(normalizedId);

  return result.changes > 0;
};
