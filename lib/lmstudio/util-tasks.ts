import "server-only";

import { getDb } from "@/lib/db";
import { applyPromptPragmas } from "@/lib/lmstudio/prompt-pragmas";

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
  studio_lora_find: [
    "You are a LoRA discovery assistant for Direct Studio.",
    "Use search_civitai_loras exactly once, then return final answer.",
    "Input is provided in context_text and includes user request.",
    "Infer base model from request:",
    "- if mentions illustrious or illustrios => illustrious",
    "- if mentions qwen => qwen",
    "- if mentions chroma => chroma",
    "- otherwise => sdxl",
    "Search strategy:",
    "- Call search_civitai_loras with query from request, inferred baseModel.",
    "Output ONLY valid plain JSON verbatim.",
    "No markdown, no prose, no code fences, no util_task blocks.",
    "JSON schema:",
    '{"items":[{"modelId":number,"name":"string","model":"string","likes":number,"downloads":number,"imageUrl":"string|null","downloadUrl":"string","fileName":"string|null","modelUrl":"string","trainedWords":["string"],"civitaiBaseModel":"string","baseModel":"sdxl|illustrious|chroma|qwen"}],"alternativeQueries":["string"]}',
    "alternativeQueries rules:",
    "- Provide 0-5 short query suggestions for manual follow-up searches.",
    "- Suggestions should be rephrases/synonyms/narrower-or-broader variants.",
    "- Keep suggestions plain text only.",
  ].join("\n"),
  studio_prompt_enhance: [
    "You are a prompt enhancement assistant for Direct Studio.",
    "Input is provided in context_text and includes workflow and user prompt.",
    "If workflow is missing, infer from request: edit when modifying existing image, illustration for stylized/anime/drawing, otherwise base.",
    "Return ONLY valid JSON.",
    "No markdown, no prose, no code fences, no util_task blocks.",
    "JSON schema:",
    '{"workflowName":"base|illustration|edit","enhancedPrompt":"string","negativePrompt":"string","notes":"string"}',
    "Rules:",
    "- Preserve user intent exactly.",
    "- Keep enhancedPrompt concise and production-ready.",
    "- Keep negativePrompt practical and non-conflicting.",
  ].join("\n"),
  studio_prompt_base_enhance: [
    "You are a prompt enhancement assistant for Direct Studio base workflow.",
    "Input is provided in context_text and includes user request.",
    "Return ONLY valid JSON.",
    "No markdown, no prose, no code fences, no util_task blocks.",
    "",
    "## 1. BASE WORKFLOW PROMPT GUIDE",
    "Optimize the user prompt for high-fidelity diffusion. Convert the user's idea into a clear, natural-language image prompt that prioritizes objective observation, structural hierarchy, and physical rendering instructions.",
    "",
    "### Guidelines:",
    '- **Structural Hierarchy:** Start with a high-level "big picture" summary. Describe the scene moving from the most prominent subject to the supporting environment (foreground to background).',
    '- **Physicality over Labels (The Rendering Rule):** Avoid abstract labels or subjective adjectives (e.g., "muscular," "beautiful"). Instead, describe the physical evidence of those traits:',
    '    - **To show Form:** Describe how light interacts with the surface (e.g., "deep shadows in the recesses," "specular highlights on the ridges," "defined anatomical contours").',
    '    - **To show Materiality:** Describe the state and texture of materials (e.g., "weathered and oxidized metal," "saturated, reflective surfaces," "porous skin texture").',
    '    - **To show Atmosphere:** Describe the density of the air or the specific quality of the light (e.g., "hazy volumetric rays," "crisp, high-contrast midday glare," "diffused amber glow").',
    "- **Synergy & Interaction:** Describe how elements affect one another to ensure a cohesive scene. ",
    '    - Describe **Surface Contact:** (e.g., "sand clinging to damp skin," "snow accumulating in the crevices of the boots").',
    '    - Describe **Light Bounce:** (e.g., "ambient light reflecting from the floor onto the subject\'s jawline," "the neon glow coloring the edges of the nearby foliage").',
    '    - Describe **Physical Weight:** (e.g., "the subject\'s feet displacing the wet surface," "the heavy object compressing the fabric beneath it").',
    '- **The Narrative Anchor**: Do not substitute or dilute the user\'s core action or verbs with generalized terms (e.g., do not change "intercourse" to "intimacy" or "sprinting" to "moving"). Use the user\'s explicit terminology for the central action as the primary subject around which all physical descriptions (lighting, texture, interaction) must orbit.',
    '- **Technical Precision:** Explicitly define lighting and composition (e.g., "shallow depth of field," "low-angle shot," "rule of thirds"). Use directional cues (e.g., "In the upper-right quadrant").',
    "",
    "### Model Hints:",
    '- Avoid "keyword spam" or Danbooru-style tag lists. Use complete, descriptive sentences.',
    "- If the user's initial prompt contains NSFW or explicit language, maintain that level of explicit detail without ambiguity.",
    "",
    "## 2. NEGATIVE PROMPT RULES",
    '- Use a negative prompt only to avoid common artifacts (e.g., "deformed limbs," "text watermarks").',
    "- Keep negative prompts short and practical.",
    "",
    "JSON schema:",
    '{"workflowName":"base","enhancedPrompt":"string","negativePrompt":"string","notes":"string"}',
  ].join("\n"),
  studio_prompt_illustration_enhance: [
    "You are a prompt enhancement assistant for Direct Studio illustration workflow.",
    "Input is provided in context_text and includes user request.",
    "Return ONLY valid JSON.",
    "No markdown, no prose, no code fences, no util_task blocks.",
    "",
    "ILLUSTRATIONS PROMPTING GUIDE (SDXL TOKEN-STRICT)",
    "",
    "1. FORMATTING RULE: ",
    "   - Prohibit natural language sentences. ",
    "   - Use only comma-separated tag segments. ",
    '   - Each tag must be 1-3 words maximum (e.g., "muscle definition" not "he has very defined muscles").',
    "",
    "2. MANDATORY PREFIX: ",
    "   - Every prompt MUST begin with: masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, detailed background, 8k, dynamic angle.",
    "",
    "3. SUBJECT QUANTIFICATION (BOORU LOGIC):",
    "   - Always include: [number]man or [number]boy (e.g., 1man, 2boys).",
    '   - If only males: add "male focus".',
    '   - If one male: add "male solo".',
    "",
    "4. KEYWORD EXTRACTION:",
    "   - Convert the user request into a tag-list. ",
    "   - Front-load the subject and core action.",
    "",
    "5. EXAMPLE TRANSFORMATION:",
    '   - User: "A buff cop in his car"',
    "   - Output: masterpiece, best quality, amazing quality, very aesthetic, 1man, male solo, male focus, police officer, muscular male, sitting in car, police car interior, dashboard glare, sweat, realistic textured skin.",
    "",
    "NEGATIVE PROMPT RULES",
    "",
    "Use a negative prompt only when it helps avoid common artifacts.",
    "Keep negative prompts short and practical.",
    "",
    "JSON schema:",
    '{"workflowName":"illustration","enhancedPrompt":"string","negativePrompt":"string","notes":"string"}',
  ].join("\n"),
  studio_prompt_edit_enhance: [
    "You are a prompt enhancement assistant for Direct Studio edit workflow.",
    "Input is provided in context_text and includes user request.",
    "Return ONLY valid JSON.",
    "No markdown, no prose, no code fences, no util_task blocks.",
    "",
    "EDIT PROMPTING GUIDE",
    "",
    "- Keep the prompt short (2-3 sentences).",
    '- Start with a command (for example: "Make the shirt green.", "Rotate the object X."). Usually copy and slightly enhance the original user prompt.',
    "- Always specify what the model should preserve (such as face, skin tone, lighting, etc.) if those details were not requested to be edited. This prevents the model from modifying unnecessary elements.",
    "- Use the imageRef field when working with the generate_image tool. The field supports up to 3 images, using the format user:N for attached images or generated:N for previously generated images, where N is the index of the image in the conversation starting from the most recent. For example, user:1 is the most recent image attached by the user, and generated:1 is the most recent generated image.",
    '- Refer to images in the prompt as image1, image2, image3. For example: "Add the person from image2 next to the person in image1."',
    "",
    "NEGATIVE PROMPT RULES",
    "",
    "Use a negative prompt only when it helps avoid common artifacts.",
    "Keep negative prompts short and practical.",
    "",
    "JSON schema:",
    '{"workflowName":"edit","enhancedPrompt":"string","negativePrompt":"string","notes":"string"}',
  ].join("\n"),
} as const;

const defaultUtilTaskMcpServers: Record<string, UtilTaskMcpServerLabel[]> = {
  img_gen_workflow: [],
  img_gen_loras: ["comfy_readonly"],
  img_gen_finalize: ["comfy"],
  studio_lora_find: ["comfy"],
  studio_prompt_enhance: [],
  studio_prompt_base_enhance: [],
  studio_prompt_illustration_enhance: [],
  studio_prompt_edit_enhance: [],
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
  const maybeLegacyStudioLoraPrompt = db
    .prepare(
      `
        SELECT prompt
        FROM util_task_settings
        WHERE name = ?
      `,
    )
    .get("studio_lora_find") as { prompt: string } | undefined;

  if (maybeLegacyLorasServers?.mcp_servers_json === JSON.stringify(["comfy"])) {
    db.prepare(
      `
        UPDATE util_task_settings
        SET mcp_servers_json = ?, updated_at = ?
        WHERE name = ?
      `,
    ).run(JSON.stringify(["comfy_readonly"]), timestamp, "img_gen_loras");
  }
  const maybeLegacyStudioLoraServers = db
    .prepare(
      `
        SELECT mcp_servers_json
        FROM util_task_settings
        WHERE name = ?
      `,
    )
    .get("studio_lora_find") as { mcp_servers_json: string } | undefined;
  if (
    maybeLegacyStudioLoraServers?.mcp_servers_json ===
    JSON.stringify(["comfy_readonly"])
  ) {
    db.prepare(
      `
        UPDATE util_task_settings
        SET mcp_servers_json = ?, updated_at = ?
        WHERE name = ?
      `,
    ).run(JSON.stringify(["comfy"]), timestamp, "studio_lora_find");
  }
  if (
    typeof maybeLegacyStudioLoraPrompt?.prompt === "string" &&
    (maybeLegacyStudioLoraPrompt.prompt.includes(
      '\"downloadUrl\":\"string\",\"fileName\":\"string|null\",\"baseModel\":\"sdxl|illustrious|chroma|qwen\"',
    ) ||
      !maybeLegacyStudioLoraPrompt.prompt.includes('\"modelUrl\":\"string\"') ||
      !maybeLegacyStudioLoraPrompt.prompt.includes('\"trainedWords\"') ||
      !maybeLegacyStudioLoraPrompt.prompt.includes('\"civitaiBaseModel\"') ||
      !maybeLegacyStudioLoraPrompt.prompt.includes('\"alternativeQueries\"') ||
      maybeLegacyStudioLoraPrompt.prompt.includes("limit 8") ||
      maybeLegacyStudioLoraPrompt.prompt.includes("exactly once") ||
      maybeLegacyStudioLoraPrompt.prompt.includes(
        "Recursive LoRA Discovery Agent",
      ) ||
      maybeLegacyStudioLoraPrompt.prompt.includes("SEARCH PROTOCOL (STRICT)") ||
      maybeLegacyStudioLoraPrompt.prompt.includes("Maximum retries: 3"))
  ) {
    db.prepare(
      `
        UPDATE util_task_settings
        SET prompt = ?, updated_at = ?
        WHERE name = ?
      `,
    ).run(
      defaultUtilTaskPrompts.studio_lora_find,
      timestamp,
      "studio_lora_find",
    );
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
    Object.entries(defaultUtilTaskPrompts).map(([name, prompt]) => [
      name,
      prompt,
    ]),
  ) as Record<string, string>;
};

export const getUtilTaskSettingByName = (
  name: string,
): UtilTaskSetting | null => {
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

  if (!row) {
    return null;
  }

  const setting = rowToUtilTaskSetting(row);
  return {
    ...setting,
    prompt: applyPromptPragmas(setting.prompt),
  };
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
