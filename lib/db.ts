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
      status TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
      lmstudio_response_id TEXT,
      conversation_summary TEXT,
      summary_updated_at TEXT,
      summary_message_count INTEGER NOT NULL DEFAULT 0,
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
  `);

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

  if (!columns.some((column) => column.name === "conversation_summary")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN conversation_summary TEXT
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
};

export const getDb = () => {
  const globalDb = globalThis as DbGlobal;

  if (!globalDb.__comfyBridgeDb) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    globalDb.__comfyBridgeDb = new Database(DB_PATH);
    ensureSchema(globalDb.__comfyBridgeDb);
  }

  return globalDb.__comfyBridgeDb;
};
