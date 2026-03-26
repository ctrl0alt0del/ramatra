import { getDb } from "@/lib/db";

type DownloadedLoraRow = {
  installed_path: string;
  base_model: string;
  source_url: string | null;
  model_id: number | null;
  model_url: string | null;
  trained_words_json: string;
  created_at: string;
  updated_at: string;
};

export type DownloadedLoraMetadata = {
  installedPath: string;
  baseModel: string;
  sourceUrl: string | null;
  modelId: number | null;
  modelUrl: string | null;
  trainedWords: string[];
  createdAt: string;
  updatedAt: string;
};

const db = getDb();

const normalizeInstalledPath = (value: string) =>
  value.trim().replace(/[\\/]+/g, "/").toLowerCase();

const parseTrainedWords = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
};

const rowToMetadata = (row: DownloadedLoraRow): DownloadedLoraMetadata => ({
  installedPath: row.installed_path,
  baseModel: row.base_model,
  sourceUrl: row.source_url,
  modelId: row.model_id,
  modelUrl: row.model_url,
  trainedWords: parseTrainedWords(row.trained_words_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const upsertDownloadedLoraMetadata = (input: {
  installedPath: string;
  baseModel: string;
  sourceUrl?: string | null;
  modelId?: number | null;
  modelUrl?: string | null;
  trainedWords?: string[];
}) => {
  const installedPath = normalizeInstalledPath(input.installedPath);
  if (!installedPath) {
    return;
  }

  const trainedWords = Array.isArray(input.trainedWords)
    ? input.trainedWords
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];
  const timestamp = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO downloaded_loras (
        installed_path,
        base_model,
        source_url,
        model_id,
        model_url,
        trained_words_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installed_path) DO UPDATE SET
        base_model = excluded.base_model,
        source_url = excluded.source_url,
        model_id = excluded.model_id,
        model_url = excluded.model_url,
        trained_words_json = excluded.trained_words_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    installedPath,
    input.baseModel,
    input.sourceUrl ?? null,
    Number.isFinite(input.modelId ?? NaN) ? input.modelId : null,
    input.modelUrl ?? null,
    JSON.stringify(trainedWords),
    timestamp,
    timestamp,
  );
};

export const listDownloadedLoraMetadataByInstalledPaths = (
  installedPaths: string[],
) => {
  const normalized = [...new Set(installedPaths.map(normalizeInstalledPath))].filter(
    (item) => item.length > 0,
  );
  if (normalized.length === 0) {
    return new Map<string, DownloadedLoraMetadata>();
  }

  const placeholders = normalized.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT
          installed_path,
          base_model,
          source_url,
          model_id,
          model_url,
          trained_words_json,
          created_at,
          updated_at
        FROM downloaded_loras
        WHERE installed_path IN (${placeholders})
      `,
    )
    .all(...normalized) as DownloadedLoraRow[];

  return new Map(
    rows.map((row) => {
      const metadata = rowToMetadata(row);
      return [metadata.installedPath, metadata];
    }),
  );
};

export const deleteDownloadedLoraMetadataByInstalledPath = (
  installedPath: string,
) => {
  const normalized = normalizeInstalledPath(installedPath);
  if (!normalized) {
    return false;
  }

  const result = db
    .prepare(
      `
        DELETE FROM downloaded_loras
        WHERE installed_path = ?
      `,
    )
    .run(normalized);

  return result.changes > 0;
};
