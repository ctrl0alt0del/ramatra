import "server-only";

import { getDb } from "@/lib/db";

type PromptPragmaSettingsRow = {
  name: string;
  template: string;
  updated_at: string;
};

export type PromptPragmaSetting = {
  name: string;
  template: string;
  updatedAt: string;
};

const defaultPromptPragmas: Record<string, string> = {
  base_workflow_prompting_guide: [
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
  ].join("\n"),
  illustration_workflow_prompting_guide: [
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
  ].join("\n"),
  edit_workflow_prompting_guide: [
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
  ].join("\n"),
};

const db = getDb();
let promptPragmaSettingsSeeded = false;

const ensurePromptPragmaSettingsSeeded = () => {
  if (promptPragmaSettingsSeeded) {
    return;
  }

  const timestamp = new Date().toISOString();
  const insert = db.prepare(
    `
      INSERT INTO prompt_pragma_settings (name, template, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO NOTHING
    `,
  );

  for (const [name, template] of Object.entries(defaultPromptPragmas)) {
    insert.run(name, template, timestamp);
  }

  promptPragmaSettingsSeeded = true;
};

const rowToPromptPragmaSetting = (
  row: PromptPragmaSettingsRow,
): PromptPragmaSetting => {
  return {
    name: row.name,
    template: row.template,
    updatedAt: row.updated_at,
  };
};

export const listDefaultPromptPragmas = () => {
  return { ...defaultPromptPragmas };
};

export const listPromptPragmaSettings = (): PromptPragmaSetting[] => {
  ensurePromptPragmaSettingsSeeded();

  const rows = db
    .prepare(
      `
        SELECT name, template, updated_at
        FROM prompt_pragma_settings
        ORDER BY name ASC
      `,
    )
    .all() as PromptPragmaSettingsRow[];

  return rows.map(rowToPromptPragmaSetting);
};

export const replacePromptPragmaSettings = (
  pragmas: Array<{ name: string; template: string }>,
) => {
  ensurePromptPragmaSettingsSeeded();

  const normalized = pragmas
    .map((pragma) => ({
      name: pragma.name.trim(),
      template: pragma.template,
    }))
    .filter((pragma) => pragma.name.length > 0);

  const timestamp = new Date().toISOString();
  const replaceTx = db.transaction(() => {
    db.prepare(`DELETE FROM prompt_pragma_settings`).run();
    const insert = db.prepare(
      `
        INSERT INTO prompt_pragma_settings (name, template, updated_at)
        VALUES (?, ?, ?)
      `,
    );
    for (const pragma of normalized) {
      insert.run(pragma.name, pragma.template, timestamp);
    }
  });
  replaceTx();

  return listPromptPragmaSettings();
};

const pragmaPattern = /\{\{@pragma:insert\s+"([^"]+)"\s*\}\}/g;

export const applyPromptPragmas = (prompt: string): string => {
  ensurePromptPragmaSettingsSeeded();

  const rows = db
    .prepare(
      `
        SELECT name, template
        FROM prompt_pragma_settings
      `,
    )
    .all() as Array<{ name: string; template: string }>;

  const templatesByName = new Map<string, string>();
  for (const row of rows) {
    templatesByName.set(row.name, row.template);
  }

  return prompt.replace(pragmaPattern, (_full, name) => {
    const template = templatesByName.get(String(name).trim());
    return typeof template === "string" ? template : "";
  });
};
