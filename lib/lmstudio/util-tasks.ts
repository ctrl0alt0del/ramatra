import "server-only";

import { getDb } from "@/lib/db";

export const utilTaskMcpServerLabels = [
  "comfy",
  "comfy_readonly",
  "web_search",
  "civitai",
  "memory",
] as const;
export type UtilTaskMcpServerLabel = (typeof utilTaskMcpServerLabels)[number];

export type UtilTaskSetting = {
  name: string;
  prompt: string;
  enabled: boolean;
  mcpServers: UtilTaskMcpServerLabel[];
  updatedAt: string;
};

type UtilTaskSettingsRow = {
  name: string;
  prompt: string;
  enabled: number;
  mcp_servers_json: string;
  updated_at: string;
};

const defaultUtilTaskPrompts = {
  img_gen_workflow: [
    "You choose the best image workflow and route to the next util task.",
    "Output only this block:",
    "[[util_task]]",
    "stage: img_gen_loras",
    "context_text: Original user prompt is <USER_PROMPT>, selected workflow: <WORKFLOW_NAME>",
    "[[/util_task]]",
    "Replace placeholders verbatim.",
    "Do not output any extra text.",
    "Do not call generate_image.",
    "Do not call any tools in this task.",
    "Pick edit only when user asked to edit existing images.",
    "Pick illustration for clearly non-photoreal stylized drawing/anime requests.",
    "Otherwise pick base.",
  ].join("\n"),
  img_gen_loras: [
    "You select LoRAs for image generation.",
    "This task must never generate images.",
    "Do not call generate_image in this task.",
    "Rules:",
    "- If list_available_loras is needed and not known, call it first.",
    "- Never call any tool except list_available_loras.",
    "- Only choose LoRAs that are exact concept matches to user request.",
    "- If uncertain, use no LoRA.",
    "- After selection, output only this block:",
    "[[util_task]]",
    "stage: img_gen_<WORKFLOW_NAME>_finalize",
    "context_text: Original user prompt is <USER_PROMPT>, selected loras: <LORA_LIST>",
    "[[/util_task]]",
    "- Replace placeholders verbatim.",
    "- If no exact match, set <LORA_LIST> to EMPTY.",
    "- Do not output any other text.",
  ].join("\n"),
  img_gen_finalize: [
    "You finalize image generation call arguments.",
    "Return JSON only.",
    "Schema:",
    '{"workflowName":"base"|"illustration"|"edit","prompt":"string","negativePrompt":"string","width":number,"height":number,"steps":number,"cfg":number,"samplerName":"string","scheduler":"string","loras":[{"name":"string","strength_model":1,"strength_clip":1}],"imageRefs":["user:1"|"generated:1"]}',
    "Respect workflow defaults unless user requested otherwise.",
    "Never set cfg above 3.5.",
    "If no LoRA, return empty loras array.",
  ].join("\n"),
} as const;

const defaultUtilTaskMcpServers: Record<string, UtilTaskMcpServerLabel[]> = {
  img_gen_workflow: [],
  img_gen_loras: ["comfy_readonly"],
  img_gen_finalize: ["comfy"],
};

export type DefaultUtilTaskName = keyof typeof defaultUtilTaskPrompts;
export const defaultUtilTaskNames = Object.keys(
  defaultUtilTaskPrompts,
) as DefaultUtilTaskName[];

const db = getDb();
let utilTaskSettingsSeeded = false;

const normalizeMcpServers = (value: unknown): UtilTaskMcpServerLabel[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const set = new Set<UtilTaskMcpServerLabel>();
  for (const item of value) {
    if (utilTaskMcpServerLabels.includes(item as UtilTaskMcpServerLabel)) {
      set.add(item as UtilTaskMcpServerLabel);
    }
  }

  return [...set];
};

const ensureUtilTaskSettingsSeeded = () => {
  if (utilTaskSettingsSeeded) {
    return;
  }

  const timestamp = new Date().toISOString();
  const insert = db.prepare(
    `
      INSERT INTO util_task_settings (name, prompt, enabled, mcp_servers_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO NOTHING
    `,
  );

  const maybeLegacyLorasServers = db
    .prepare(
      `
        SELECT mcp_servers_json
        FROM util_task_settings
        WHERE name = ?
      `,
    )
    .get("img_gen_loras") as { mcp_servers_json: string } | undefined;

  if (maybeLegacyLorasServers?.mcp_servers_json === JSON.stringify(["comfy"])) {
    db.prepare(
      `
        UPDATE util_task_settings
        SET mcp_servers_json = ?, updated_at = ?
        WHERE name = ?
      `,
    ).run(JSON.stringify(["comfy_readonly"]), timestamp, "img_gen_loras");
  }
  for (const [name, prompt] of Object.entries(defaultUtilTaskPrompts)) {
    insert.run(
      name,
      prompt,
      1,
      JSON.stringify(defaultUtilTaskMcpServers[name] ?? []),
      timestamp,
    );
  }

  utilTaskSettingsSeeded = true;
};

const rowToUtilTaskSetting = (row: UtilTaskSettingsRow): UtilTaskSetting => {
  let parsedMcpServers: unknown = [];
  try {
    parsedMcpServers = JSON.parse(row.mcp_servers_json);
  } catch {
    parsedMcpServers = [];
  }

  return {
    name: row.name,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    mcpServers: normalizeMcpServers(parsedMcpServers),
    updatedAt: row.updated_at,
  };
};

export const listUtilTaskSettings = (): UtilTaskSetting[] => {
  ensureUtilTaskSettingsSeeded();

  const rows = db
    .prepare(
      `
        SELECT name, prompt, enabled, mcp_servers_json, updated_at
        FROM util_task_settings
        ORDER BY name ASC
      `,
    )
    .all() as UtilTaskSettingsRow[];

  return rows.map(rowToUtilTaskSetting);
};

export const listDefaultUtilTaskPrompts = () => {
  return Object.fromEntries(
    Object.entries(defaultUtilTaskPrompts).map(([name, prompt]) => [name, prompt]),
  ) as Record<string, string>;
};

export const getUtilTaskSettingByName = (name: string): UtilTaskSetting | null => {
  ensureUtilTaskSettingsSeeded();
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT name, prompt, enabled, mcp_servers_json, updated_at
        FROM util_task_settings
        WHERE name = ?
      `,
    )
    .get(normalizedName) as UtilTaskSettingsRow | undefined;

  return row ? rowToUtilTaskSetting(row) : null;
};

export const replaceUtilTaskSettings = (
  tasks: Array<{
    name: string;
    prompt: string;
    enabled?: boolean;
    mcpServers?: UtilTaskMcpServerLabel[];
  }>,
) => {
  ensureUtilTaskSettingsSeeded();
  const normalizedTasks = tasks
    .map((task) => ({
      name: task.name.trim(),
      prompt: task.prompt.trim(),
      enabled: task.enabled !== false,
      mcpServers: normalizeMcpServers(task.mcpServers ?? []),
    }))
    .filter((task) => task.name.length > 0);

  const timestamp = new Date().toISOString();
  const replaceTx = db.transaction(() => {
    db.prepare(`DELETE FROM util_task_settings`).run();
    const insert = db.prepare(
      `
        INSERT INTO util_task_settings (name, prompt, enabled, mcp_servers_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    );
    for (const task of normalizedTasks) {
      insert.run(
        task.name,
        task.prompt,
        task.enabled ? 1 : 0,
        JSON.stringify(task.mcpServers),
        timestamp,
      );
    }
  });
  replaceTx();

  return listUtilTaskSettings();
};




