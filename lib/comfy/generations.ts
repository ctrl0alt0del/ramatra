import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";

export type StoredGenerationImage = {
  mimeType: string;
  data: string;
};

export type StoredGeneration =
  | {
      jobId: string;
      status: "queued" | "running";
      progress: {
        value: number | null;
        max: number | null;
        percentage: number | null;
        node: string | null;
      };
    }
  | {
      jobId: string;
      status: "failed";
      error: string | null;
    }
  | {
      jobId: string;
      status: "completed";
      images: StoredGenerationImage[];
    };

type GenerationRow = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress_value: number | null;
  progress_max: number | null;
  progress_node: string | null;
  error: string | null;
};

type GenerationImageRow = {
  mime_type: string;
  file_path: string;
};

const db = getDb();
const RESULTS_DIR = path.join(process.cwd(), ".data", "comfy-results");

const getPercentage = (value: number | null, max: number | null) => {
  if (value === null || max === null || max <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
};

const ensureResultsDir = () => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
};

const getExtensionForMimeType = (mimeType: string) => {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
};

export const createGeneration = (input: {
  jobId: string;
  workflowName?: string;
  status: "queued" | "running";
}) => {
  const timestamp = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO comfy_generations (
        job_id, workflow_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        workflow_name = excluded.workflow_name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.jobId,
    input.workflowName ?? null,
    input.status,
    timestamp,
    timestamp,
  );
};

export const updateGenerationProgress = (input: {
  jobId: string;
  value: number;
  max: number;
  node?: string | null;
}) => {
  const timestamp = new Date().toISOString();

  db.prepare(
    `
      UPDATE comfy_generations
      SET status = 'running',
          progress_value = ?,
          progress_max = ?,
          progress_node = ?,
          error = NULL,
          updated_at = ?
      WHERE job_id = ?
    `,
  ).run(input.value, input.max, input.node ?? null, timestamp, input.jobId);
};

export const markGenerationFailed = (jobId: string, error: string) => {
  const timestamp = new Date().toISOString();

  db.prepare(
    `
      UPDATE comfy_generations
      SET status = 'failed',
          error = ?,
          updated_at = ?
      WHERE job_id = ?
    `,
  ).run(error, timestamp, jobId);
};

export const storeCompletedGeneration = (input: {
  jobId: string;
  workflowName?: string;
  images: StoredGenerationImage[];
}) => {
  ensureResultsDir();
  const timestamp = new Date().toISOString();
  const generationDir = path.join(RESULTS_DIR, input.jobId);
  fs.mkdirSync(generationDir, { recursive: true });

  const tx = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO comfy_generations (
          job_id, workflow_name, status, progress_value, progress_max, progress_node, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, 'completed', NULL, NULL, NULL, NULL, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          workflow_name = excluded.workflow_name,
          status = 'completed',
          progress_value = NULL,
          progress_max = NULL,
          progress_node = NULL,
          error = NULL,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `,
    ).run(
      input.jobId,
      input.workflowName ?? null,
      timestamp,
      timestamp,
      timestamp,
    );

    db.prepare(`DELETE FROM comfy_generation_images WHERE job_id = ?`).run(
      input.jobId,
    );

    for (const [index, image] of input.images.entries()) {
      const extension = getExtensionForMimeType(image.mimeType);
      const filePath = path.join(generationDir, `${index}.${extension}`);
      fs.writeFileSync(filePath, Buffer.from(image.data, "base64"));

      db.prepare(
        `
          INSERT INTO comfy_generation_images (
            id, job_id, mime_type, file_path, position, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        crypto.randomUUID(),
        input.jobId,
        image.mimeType,
        filePath,
        index,
        timestamp,
      );
    }
  });

  tx();
};

export const getStoredGeneration = (jobId: string): StoredGeneration | null => {
  const row = db
    .prepare(
      `
        SELECT
          job_id,
          status,
          progress_value,
          progress_max,
          progress_node,
          error
        FROM comfy_generations
        WHERE job_id = ?
      `,
    )
    .get(jobId) as GenerationRow | undefined;

  if (!row) return null;

  if (row.status === "completed") {
    const imageRows = db
      .prepare(
        `
          SELECT mime_type, file_path
          FROM comfy_generation_images
          WHERE job_id = ?
          ORDER BY position ASC
        `,
      )
      .all(jobId) as GenerationImageRow[];

    const images = imageRows.map((imageRow) => ({
      mimeType: imageRow.mime_type,
      data: fs.readFileSync(imageRow.file_path).toString("base64"),
    }));

    return {
      jobId,
      status: "completed",
      images,
    };
  }

  if (row.status === "failed") {
    return {
      jobId,
      status: "failed",
      error: row.error,
    };
  }

  return {
    jobId,
    status: row.status,
    progress: {
      value: row.progress_value,
      max: row.progress_max,
      percentage: getPercentage(row.progress_value, row.progress_max),
      node: row.progress_node,
    },
  };
};
