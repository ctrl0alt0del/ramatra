import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DB_DIR, "comfy-bridge.sqlite");

type DbGlobal = typeof globalThis & {
  __comfyBridgeDb?: Database.Database;
  __comfyBridgeSchemaEnsured?: boolean;
};

const migrateLegacyStreamSignalText = (input: string) => {
  let output = input;

  const replacements: Array<[RegExp, string]> = [
    [/"__type"\s*:\s*"chat\.stream_command"/g, '"__type":"chat.stream_signal"'],
    [/'__type'\s*:\s*'chat\.stream_command'/g, "'__type':'chat.stream_signal'"],
    [/"command"\s*:\s*"enqueue_util_task"/g, '"route":"util_task"'],
    [/'command'\s*:\s*'enqueue_util_task'/g, "'route':'util_task'"],
    [/"utilTask"\s*:/g, '"stage":'],
    [/'utilTask'\s*:/g, "'stage':"],
    [/"system_prompt_ext"\s*:/g, '"context_text":'],
    [/'system_prompt_ext'\s*:/g, "'context_text':"],
    [/\benqueue_util_task\b/g, "util_task"],
    [/\bsystem_prompt_ext\b/g, "context_text"],
    [/\butilTask\b/g, "stage"],
  ];

  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  output = output.replace(
    /\{"__type":"chat\.stream_signal","route":"util_task","stage":"([^"]+)","context_text":"([^"]*)"\}/g,
    "[[util_task]]\nstage: $1\ncontext_text: $2\n[[/util_task]]",
  );
  output = output.replace(
    /\{'__type':'chat\.stream_signal','route':'util_task','stage':'([^']+)','context_text':'([^']*)'\}/g,
    "[[util_task]]\nstage: $1\ncontext_text: $2\n[[/util_task]]",
  );
  output = output.replace(
    /Output only valid JSON with this exact shape:/gi,
    "Output only this bracket command block:",
  );
  output = output.replace(/Do not output any text before or after the JSON\./gi, "Do not output any text before or after this block.");
  output = output.replace(/Do not include markdown, code fences, or explanations\./gi, "Do not include markdown, code fences, JSON, or explanations.");

  return output;
};

const buildDefaultGroupTasks = (
  taskGroupType: string,
  payload: Record<string, unknown>,
) => {
  if (taskGroupType === "chat") {
    const kind = typeof payload.kind === "string" ? payload.kind : "";
    if (kind === "conversation") {
      return [
        { id: crypto.randomUUID(), kind: "chat.generate", status: "pending" },
        { id: crypto.randomUUID(), kind: "chat.stream", status: "pending" },
      ];
    }

    if (kind === "critique") {
      return [
        { id: crypto.randomUUID(), kind: "chat.unbiased_critique", status: "pending" },
        { id: crypto.randomUUID(), kind: "chat.biased_critique", status: "pending" },
        { id: crypto.randomUUID(), kind: "chat.stream", status: "pending" },
      ];
    }

    if (kind === "update_intent") {
      return [{ id: crypto.randomUUID(), kind: "chat.intent", status: "pending" }];
    }

    if (kind === "generate_title") {
      return [{ id: crypto.randomUUID(), kind: "chat.title", status: "pending" }];
    }

    if (kind === "collapse_context") {
      return [{ id: crypto.randomUUID(), kind: "chat.compact", status: "pending" }];
    }
  }

  if (taskGroupType === "comfy") {
    return [
      { id: crypto.randomUUID(), kind: "image.generate", status: "pending" },
      { id: crypto.randomUUID(), kind: "image.stream", status: "pending" },
    ];
  }

  return [];
};

const ensureSchema = (db: Database.Database) => {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_generated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'archived')),
      active_leaf_message_id TEXT,
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
      user_intent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      parent_message_id TEXT,
      message_ui_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      token_load INTEGER NOT NULL DEFAULT 0,
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
      mode TEXT PRIMARY KEY CHECK (mode IN ('fast', 'regular', 'writer', 'roleplay', 'artist')),
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mood_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS util_task_settings (
      name TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      mcp_servers_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);

  const promptModeSettingsSqlRow = db
    .prepare(
      `
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'prompt_mode_settings'
      `,
    )
    .get() as { sql: string } | undefined;

  const promptModeSettingsSql = (promptModeSettingsSqlRow?.sql ?? "").toLowerCase();
  if (
    promptModeSettingsSql.length > 0 &&
    !promptModeSettingsSql.includes("'roleplay'")
  ) {
    db.exec(`
      ALTER TABLE prompt_mode_settings RENAME TO prompt_mode_settings_legacy;

      CREATE TABLE prompt_mode_settings (
        mode TEXT PRIMARY KEY CHECK (mode IN ('fast', 'regular', 'writer', 'roleplay', 'artist')),
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO prompt_mode_settings (mode, prompt, updated_at)
      SELECT mode, prompt, updated_at
      FROM prompt_mode_settings_legacy
      WHERE mode IN ('fast', 'regular', 'writer', 'artist');

      DROP TABLE prompt_mode_settings_legacy;
    `);
  }

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

  const didAddActiveLeafMessageIdColumn = !columns.some(
    (column) => column.name === "active_leaf_message_id",
  );

  if (didAddActiveLeafMessageIdColumn) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN active_leaf_message_id TEXT
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

  if (!columns.some((column) => column.name === "user_intent")) {
    db.exec(`
      ALTER TABLE threads
      ADD COLUMN user_intent TEXT
    `);
  }

  const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{
    name: string;
  }>;

  const didAddParentMessageIdColumn = !messageColumns.some(
    (column) => column.name === "parent_message_id",
  );

  if (didAddParentMessageIdColumn) {
    db.exec(`
      ALTER TABLE messages
      ADD COLUMN parent_message_id TEXT
    `);
  }

  if (!messageColumns.some((column) => column.name === "token_load")) {
    db.exec(`
      ALTER TABLE messages
      ADD COLUMN token_load INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!messageColumns.some((column) => column.name === "message_ui_id")) {
    db.exec(`
      ALTER TABLE messages
      ADD COLUMN message_ui_id TEXT
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread_parent
      ON messages(thread_id, parent_message_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread_ui
      ON messages(thread_id, message_ui_id)
  `);

  const linearBackfillThreads = db
    .prepare(`SELECT id FROM threads`)
    .all() as Array<{ id: string }>;

  if (didAddParentMessageIdColumn) {
    const backfillBranchShape = db.transaction(() => {
      for (const thread of linearBackfillThreads) {
        const rows = db
          .prepare(
            `
              SELECT id, parent_message_id
              FROM messages
              WHERE thread_id = ?
              ORDER BY position ASC
            `,
          )
          .all(thread.id) as Array<{ id: string; parent_message_id: string | null }>;

        let previousId: string | null = null;
        for (const row of rows) {
          if (row.parent_message_id === null) {
            db.prepare(`UPDATE messages SET parent_message_id = ? WHERE id = ?`).run(
              previousId,
              row.id,
            );
          }
          previousId = row.id;
        }
      }
    });

    backfillBranchShape();
  }

  const needsActiveLeafBackfill =
    didAddActiveLeafMessageIdColumn ||
    Boolean(
      db
        .prepare(
          `
            SELECT 1
            FROM threads
            WHERE active_leaf_message_id IS NULL
            LIMIT 1
          `,
        )
        .get(),
    );

  if (needsActiveLeafBackfill) {
    const backfillActiveLeaf = db.transaction(() => {
      for (const thread of linearBackfillThreads) {
        const latestMessage = db
          .prepare(
            `
              SELECT id
              FROM messages
              WHERE thread_id = ?
              ORDER BY position DESC, created_at DESC
              LIMIT 1
            `,
          )
          .get(thread.id) as { id: string } | undefined;

        if (latestMessage) {
          db.prepare(
            `
              UPDATE threads
              SET active_leaf_message_id = ?
              WHERE id = ? AND active_leaf_message_id IS NULL
            `,
          ).run(latestMessage.id, thread.id);
        }
      }
    });

    backfillActiveLeaf();
  }

  const utilTaskColumns = db.prepare(`PRAGMA table_info(util_task_settings)`).all() as Array<{
    name: string;
  }>;
  if (!utilTaskColumns.some((column) => column.name === "mcp_servers_json")) {
    db.exec(`
      ALTER TABLE util_task_settings
      ADD COLUMN mcp_servers_json TEXT NOT NULL DEFAULT '[]'
    `);
    db.exec(`
      UPDATE util_task_settings
      SET mcp_servers_json = '[]'
      WHERE mcp_servers_json IS NULL OR TRIM(COALESCE(mcp_servers_json, '')) = ''
    `);
  }

  const migratePromptSetting = db.prepare(
    `
      UPDATE prompt_mode_settings
      SET prompt = ?, updated_at = ?
      WHERE mode = ?
    `,
  );
  const promptSettingRows = db
    .prepare(`SELECT mode, prompt FROM prompt_mode_settings`)
    .all() as Array<{ mode: string; prompt: string }>;
  const now = new Date().toISOString();
  for (const row of promptSettingRows) {
    const migratedPrompt = migrateLegacyStreamSignalText(row.prompt);
    if (migratedPrompt !== row.prompt) {
      migratePromptSetting.run(migratedPrompt, now, row.mode);
    }
  }

  const migrateUtilTaskSetting = db.prepare(
    `
      UPDATE util_task_settings
      SET prompt = ?, updated_at = ?
      WHERE name = ?
    `,
  );
  const utilTaskSettingRows = db
    .prepare(`SELECT name, prompt FROM util_task_settings`)
    .all() as Array<{ name: string; prompt: string }>;
  for (const row of utilTaskSettingRows) {
    const migratedPrompt = migrateLegacyStreamSignalText(row.prompt);
    if (migratedPrompt !== row.prompt) {
      migrateUtilTaskSetting.run(migratedPrompt, now, row.name);
    }
  }

  const taskRows = db
    .prepare(`SELECT id, type, payload_json FROM tasks`)
    .all() as Array<{
    id: string;
    type: string;
    payload_json: string;
  }>;
  const migrateTaskPayload = db.prepare(
    `
      UPDATE tasks
      SET payload_json = ?
      WHERE id = ?
    `,
  );
  const migrateTaskPayloadsTx = db.transaction(() => {
    for (const row of taskRows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        continue;
      }

      let changed = false;
      if (
        !Array.isArray(payload.tasks) &&
        Array.isArray(payload.responsibilities)
      ) {
        payload.tasks = payload.responsibilities
          .filter((item): item is Record<string, unknown> => {
            return item !== null && typeof item === "object";
          })
          .map((item) => {
            const id =
              typeof item.id === "string" && item.id
                ? item.id
                : crypto.randomUUID();
            const kind = typeof item.kind === "string" ? item.kind : "";
            const legacyState = typeof item.state === "string" ? item.state : "";
            const status =
              legacyState === "pending" ||
              legacyState === "running" ||
              legacyState === "completed" ||
              legacyState === "failed"
                ? legacyState
                : "pending";
            return { id, kind, status };
          })
          .filter((item) => item.kind.length > 0);
        changed = true;
      }

      if (Array.isArray(payload.tasks)) {
        const normalizedTasks = payload.tasks
          .filter((item): item is Record<string, unknown> => {
            return item !== null && typeof item === "object";
          })
          .map((item) => {
            const statusValue =
              typeof item.status === "string" ? item.status : "pending";
            const normalizedStatus =
              statusValue === "running" ||
              statusValue === "completed" ||
              statusValue === "failed"
                ? statusValue
                : "pending";
            if (item.status !== normalizedStatus) {
              changed = true;
            }
            return {
              ...item,
              status: normalizedStatus,
            };
          });
        payload.tasks = normalizedTasks;
      }

      if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
        const defaults = buildDefaultGroupTasks(row.type, payload);
        if (defaults.length > 0) {
          payload.tasks = defaults;
          changed = true;
        }
      }

      if ("responsibilities" in payload) {
        delete payload.responsibilities;
        changed = true;
      }

      if (changed) {
        migrateTaskPayload.run(JSON.stringify(payload), row.id);
      }
    }
  });
  migrateTaskPayloadsTx();
};

export const getDb = () => {
  const globalDb = globalThis as DbGlobal;

  if (!globalDb.__comfyBridgeDb) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    globalDb.__comfyBridgeDb = new Database(DB_PATH);
  }

  if (!globalDb.__comfyBridgeSchemaEnsured) {
    ensureSchema(globalDb.__comfyBridgeDb);
    globalDb.__comfyBridgeSchemaEnsured = true;
  }

  return globalDb.__comfyBridgeDb;
};





