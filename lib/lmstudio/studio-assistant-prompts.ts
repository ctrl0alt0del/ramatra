import "server-only";

import { getDb } from "@/lib/db";

import { applyPromptPragmas } from "./prompt-pragmas";

const studioAssistantMode = "studio_assistant" as const;

const defaultStudioAssistantPrompt = `You are Studio Assistant router for Direct Comfy workflows.
You are stateless per request and must never rely on previous messages.
Your job is only to choose the correct util task stage based on user request.
Do not execute any external actions in this router step.
Do not output JSON in this router step.

Routing rules:
- If user asks to find/search/recommend LoRAs, output stage studio_lora_find.
- If user asks to improve/enhance/rewrite/optimize prompt, route by workflow:
  - edit workflow => studio_prompt_edit_enhance
  - illustration workflow => studio_prompt_illustration_enhance
  - radiance workflow => studio_prompt_radiance_enhance
  - base workflow or unknown workflow => studio_prompt_base_enhance
- Infer workflow from user intent when not explicit: edit for modifying existing image, illustration for stylized/anime/drawing tags, radiance for requests explicitly emphasizing high quality/professional photoreal results, otherwise base.
- If both LoRA search and prompt enhancement are requested, prefer studio_lora_find.

Output format (required, and nothing else):
[[util_task]]
stage: <STAGE_NAME>
context_text: <ORIGINAL_USER_MESSAGE>
[[/util_task]]

Replace placeholders with exact values.
No prose, no markdown, no extra lines before or after the block.`;

const db = getDb();
let seeded = false;

const ensureSeeded = () => {
  if (seeded) return;

  const timestamp = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO prompt_mode_settings (mode, prompt, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(mode) DO NOTHING
    `,
  ).run(studioAssistantMode, defaultStudioAssistantPrompt, timestamp);

  const existing = db
    .prepare(
      `
        SELECT prompt
        FROM prompt_mode_settings
        WHERE mode = ?
      `,
    )
    .get(studioAssistantMode) as { prompt: string } | undefined;

  if (
    typeof existing?.prompt === "string" &&
    existing.prompt.includes("studio_prompt_base_enhance") &&
    !existing.prompt.includes("studio_prompt_radiance_enhance")
  ) {
    db.prepare(
      `
        UPDATE prompt_mode_settings
        SET prompt = ?, updated_at = ?
        WHERE mode = ?
      `,
    ).run(defaultStudioAssistantPrompt, timestamp, studioAssistantMode);
  }

  seeded = true;
};

export const getStudioAssistantModeKey = () => studioAssistantMode;

export const getDefaultStudioAssistantSystemPrompt = () =>
  defaultStudioAssistantPrompt;

export const getStudioAssistantSystemPrompt = () => {
  ensureSeeded();

  const row = db
    .prepare(
      `
        SELECT prompt
        FROM prompt_mode_settings
        WHERE mode = ?
      `,
    )
    .get(studioAssistantMode) as { prompt: string } | undefined;

  const prompt = row?.prompt?.trim();
  const resolved =
    typeof prompt === "string" && prompt.length > 0
      ? prompt
      : defaultStudioAssistantPrompt;
  return applyPromptPragmas(resolved);
};

export const updateStudioAssistantSystemPrompt = (prompt: string) => {
  ensureSeeded();

  const normalizedPrompt = prompt.trim() || defaultStudioAssistantPrompt;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO prompt_mode_settings (mode, prompt, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(mode) DO UPDATE SET
        prompt = excluded.prompt,
        updated_at = excluded.updated_at
    `,
  ).run(studioAssistantMode, normalizedPrompt, updatedAt);
};
