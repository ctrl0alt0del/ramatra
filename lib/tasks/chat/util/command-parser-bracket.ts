import type { ChatStreamCommand } from "@/lib/tasks/chat/util/command-parser.types";

export const parseBracketUtilCommand = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null as { command: ChatStreamCommand; cleanText: string } | null;
  }

  const blockPattern =
    /\[\[util_task((?:@[a-zA-Z]+)*)\]\]([\s\S]*?)(?:\[\[\/util_task\]\]|\[\/util_task\])/gi;
  const blockMatches = [...trimmed.matchAll(blockPattern)];
  for (let index = blockMatches.length - 1; index >= 0; index -= 1) {
    const match = blockMatches[index];
    const full = match[0] ?? "";
    const tagSegment = (match[1] ?? "").toLowerCase();
    const body = (match[2] ?? "").trim();
    const tags = tagSegment
      .split("@")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const isPersistent =
      tags.includes("persistent") || tags.includes("persistant");
    const isStateless = tags.includes("stateless");
    const isVisualOnly =
      tags.includes("visualonly") || tags.includes("visual_only");
    if (!full || !body) {
      continue;
    }

    const fields: Record<string, string> = {};
    let currentKey: string | null = null;
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        if (currentKey && fields[currentKey] !== undefined) {
          fields[currentKey] = `${fields[currentKey]}\n`;
        }
        continue;
      }

      const separatorIndex = rawLine.indexOf(":");
      const rawKey =
        separatorIndex > 0 ? rawLine.slice(0, separatorIndex).trim().toLowerCase() : "";
      const isFieldKey = /^[a-z_][a-z0-9_]*$/.test(rawKey);

      if (separatorIndex > 0 && isFieldKey) {
        const value = rawLine.slice(separatorIndex + 1).trim();
        fields[rawKey] = value;
        currentKey = rawKey;
        continue;
      }

      if (currentKey && fields[currentKey] !== undefined) {
        fields[currentKey] = fields[currentKey]
          ? `${fields[currentKey]}\n${line}`
          : line;
      }
    }

    const stage = fields.stage?.trim() ?? "";
    if (!stage || stage.includes("<") || stage.includes(">")) {
      continue;
    }

    const command: ChatStreamCommand = {
      __type: "chat.stream_signal",
      route: "util_task",
      stage,
      ...(fields.context_text ? { context_text: fields.context_text } : {}),
      ...(fields.nonce ? { nonce: fields.nonce } : {}),
      ...(isPersistent ? { persistent: true } : {}),
      ...(isStateless ? { stateless: true } : {}),
      ...(isVisualOnly ? { visualonly: true } : {}),
    };

    const cleanText = trimmed.replace(full, "").trim();
    return { command, cleanText };
  }

  const inlinePattern = /\[\[util_task:([a-zA-Z0-9_.-]+)(?:\|([^\]]+))?\]\]/gi;
  const inlineMatches = [...trimmed.matchAll(inlinePattern)];
  for (let index = inlineMatches.length - 1; index >= 0; index -= 1) {
    const match = inlineMatches[index];
    const full = match[0] ?? "";
    const stage = (match[1] ?? "").trim();
    const optionsRaw = (match[2] ?? "").trim();
    if (!full || !stage) {
      continue;
    }
    if (stage.includes("<") || stage.includes(">")) {
      continue;
    }

    const options: Record<string, string> = {};
    if (optionsRaw) {
      for (const entry of optionsRaw.split("|")) {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }
        const key = entry.slice(0, separatorIndex).trim().toLowerCase();
        const value = entry.slice(separatorIndex + 1).trim();
        if (key && value) {
          options[key] = value;
        }
      }
    }

    const command: ChatStreamCommand = {
      __type: "chat.stream_signal",
      route: "util_task",
      stage,
      ...(options.context_text ? { context_text: options.context_text } : {}),
      ...(options.nonce ? { nonce: options.nonce } : {}),
      ...(options.persistent === "true" || options.persistent === "1"
        ? { persistent: true }
        : {}),
      ...(options.stateless === "true" || options.stateless === "1"
        ? { stateless: true }
        : {}),
      ...(options.visualonly === "true" ||
      options.visualonly === "1" ||
      options.visual_only === "true" ||
      options.visual_only === "1"
        ? { visualonly: true }
        : {}),
    };
    const cleanText = trimmed.replace(full, "").trim();
    return { command, cleanText };
  }

  return null;
};
