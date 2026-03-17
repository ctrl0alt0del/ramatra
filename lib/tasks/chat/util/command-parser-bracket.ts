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
    if (!full || !body) {
      continue;
    }

    const fields: Record<string, string> = {};
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      if (key && value) {
        fields[key] = value;
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
    };
    const cleanText = trimmed.replace(full, "").trim();
    return { command, cleanText };
  }

  return null;
};
