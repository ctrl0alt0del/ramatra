import "server-only";

import { getDb } from "@/lib/db";

export type MoodSetting = {
  id: string;
  label: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

type MoodRow = {
  id: string;
  label: string;
  prompt: string;
  created_at: string;
  updated_at: string;
};

const db = getDb();

const defaultMoods: Array<{ id: string; label: string; prompt: string }> = [
  {
    id: "dry",
    label: "Dry",
    prompt: [
      "Tone: dry, restrained, and matter-of-fact.",
      "Keep responses concise and low-emotion.",
      "Avoid hype, fluff, and dramatic phrasing.",
      "Prioritize directness and practical clarity.",
    ].join("\n"),
  },
  {
    id: "explainative",
    label: "Explainative",
    prompt: [
      "Tone: explanatory and instructional.",
      "Explain reasoning step by step in plain language.",
      "Use clear structure and practical examples when useful.",
      "Optimize for user understanding over brevity.",
    ].join("\n"),
  },
  {
    id: "creative",
    label: "Creative",
    prompt: [
      "Tone: imaginative and idea-forward.",
      "Offer novel options and fresh angles when relevant.",
      "Use vivid but clear language; stay useful and coherent.",
      "Do not sacrifice factual accuracy for style.",
    ].join("\n"),
  },
];

let moodSettingsSeeded = false;

const ensureMoodSettingsSeeded = () => {
  if (moodSettingsSeeded) {
    return;
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM mood_settings`)
    .get() as { total: number };

  if ((countRow?.total ?? 0) > 0) {
    moodSettingsSeeded = true;
    return;
  }

  const now = new Date().toISOString();
  const insert = db.prepare(
    `
      INSERT INTO mood_settings (id, label, prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `,
  );

  for (const mood of defaultMoods) {
    insert.run(mood.id, mood.label, mood.prompt, now, now);
  }

  moodSettingsSeeded = true;
};

const toMoodSetting = (row: MoodRow): MoodSetting => {
  return {
    id: row.id,
    label: row.label,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listMoodSettings = (): MoodSetting[] => {
  ensureMoodSettingsSeeded();

  const rows = db
    .prepare(
      `
        SELECT id, label, prompt, created_at, updated_at
        FROM mood_settings
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all() as MoodRow[];

  return rows.map(toMoodSetting);
};

export const replaceMoodSettings = (
  moods: Array<{
    id: string;
    label: string;
    prompt: string;
  }>,
) => {
  ensureMoodSettingsSeeded();

  const normalized = moods
    .map((item) => ({
      id: item.id.trim(),
      label: item.label.trim(),
      prompt: item.prompt.trim(),
    }))
    .filter((item) => item.id.length > 0 && item.label.length > 0);

  const updateTx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM mood_settings`)
      .all() as Array<{ id: string }>;
    const keepIds = new Set(normalized.map((item) => item.id));

    for (const row of existing) {
      if (!keepIds.has(row.id)) {
        db.prepare(`DELETE FROM mood_settings WHERE id = ?`).run(row.id);
      }
    }

    const insertOrUpdate = db.prepare(
      `
        INSERT INTO mood_settings (id, label, prompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          prompt = excluded.prompt,
          updated_at = excluded.updated_at
      `,
    );

    for (const mood of normalized) {
      const now = new Date().toISOString();
      insertOrUpdate.run(mood.id, mood.label, mood.prompt, now, now);
    }
  });

  updateTx();
  return listMoodSettings();
};

export const getMoodPromptById = (moodId: string | null | undefined) => {
  ensureMoodSettingsSeeded();

  const id = moodId?.trim();
  if (!id) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT prompt
        FROM mood_settings
        WHERE id = ?
      `,
    )
    .get(id) as { prompt: string } | undefined;

  const prompt = row?.prompt?.trim();
  return prompt?.length ? prompt : null;
};
