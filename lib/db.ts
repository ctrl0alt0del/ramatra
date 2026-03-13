import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DB_DIR, "comfy-bridge.sqlite");

type DbGlobal = typeof globalThis & {
  __comfyBridgeDb?: Database.Database;
};

const ensureSchema = (db: Database.Database) => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_generated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
      lmstudio_response_id TEXT,
      lmstudio_model_instance_id TEXT,
      last_prompt_mode TEXT,
      conversation_summary TEXT,
      summary_updated_at TEXT,
      summary_message_count INTEGER NOT NULL DEFAULT 0,
      summary_call_count_total INTEGER NOT NULL DEFAULT 0,
      summary_calls_in_current_request INTEGER NOT NULL DEFAULT 0,
      context_window_used_tokens INTEGER,
      context_window_total_tokens INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread_position
      ON messages(thread_id, position);

    CREATE TABLE IF NOT EXISTS comfy_generations (
      job_id TEXT PRIMARY KEY,
      workflow_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      progress_value INTEGER,
      progress_max INTEGER,
      progress_node TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comfy_generation_images (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES comfy_generations(job_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comfy_generation_images_job_position
      ON comfy_generation_images(job_id, position);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('chat', 'comfy')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_type_status_created_at
      ON tasks(type, status, created_at);

    CREATE TABLE IF NOT EXISTS task_runtime_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      active_task_id TEXT,
      gpu_mode TEXT NOT NULL DEFAULT 'chat' CHECK (gpu_mode IN ('chat', 'comfy', 'switching')),
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS comfy_task_jobs (
      job_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_mode_settings (
      mode TEXT PRIMARY KEY CHECK (mode IN ('fast', 'regular', 'writer', 'artist')),
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(
    `
      INSERT INTO task_runtime_state (singleton_id, active_task_id, gpu_mode, last_error)
      VALUES (1, NULL, 'chat', NULL)
      ON CONFLICT(singleton_id) DO NOTHING
    `,
  ).run();

  const columns = db.prepare(`PRAGMA table_info(threads)`).all() as Array<{
    name: string;
  }>;

  if (!columns.some((column) => column.name === "status")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN status TEXT NOT NULL DEFAULT 'regular'
    `);
    db.exec(`
      UPDATE threads
      SET status = 'regular'
      WHERE status IS NULL OR status = ''
    `);
  }

  if (!columns.some((column) => column.name === "lmstudio_response_id")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN lmstudio_response_id TEXT
    `);
  }

  if (!columns.some((column) => column.name === "title_generated")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN title_generated INTEGER NOT NULL DEFAULT 0
    `);
    db.exec(`
      UPDATE threads
      SET title_generated =
        CASE
          WHEN LOWER(TRIM(COALESCE(title, ''))) = 'new chat' OR TRIM(COALESCE(title, '')) = ''
            THEN 0
          ELSE 1
        END
    `);
  }

  if (!columns.some((column) => column.name === "lmstudio_model_instance_id")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN lmstudio_model_instance_id TEXT
    `);
  }

  if (!columns.some((column) => column.name === "conversation_summary")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN conversation_summary TEXT
    `);
  }

  if (!columns.some((column) => column.name === "last_prompt_mode")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN last_prompt_mode TEXT
    `);
  }

  if (!columns.some((column) => column.name === "summary_updated_at")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN summary_updated_at TEXT
    `);
  }

  if (!columns.some((column) => column.name === "summary_message_count")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN summary_message_count INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!columns.some((column) => column.name === "summary_call_count_total")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN summary_call_count_total INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (
    !columns.some(
      (column) => column.name === "summary_calls_in_current_request",
    )
  ) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN summary_calls_in_current_request INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!columns.some((column) => column.name === "context_window_used_tokens")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN context_window_used_tokens INTEGER
    `);
  }

  if (!columns.some((column) => column.name === "context_window_total_tokens")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN context_window_total_tokens INTEGER
    `);
  }
};

export const getDb = () => {
  const globalDb = globalThis as DbGlobal;

  if (!globalDb.__comfyBridgeDb) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    globalDb.__comfyBridgeDb = new Database(DB_PATH);
  }

  ensureSchema(globalDb.__comfyBridgeDb);
  return globalDb.__comfyBridgeDb;
};
