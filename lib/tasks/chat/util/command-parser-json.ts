import type { ChatStreamCommand } from "@/lib/tasks/chat/util/command-parser.types";

export const extractJsonObjectCandidates = (text: string) => {
  const candidates: string[] = [];
  let inString = false;
  let escape = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }

  return candidates;
};

export const parseJsonUtilCommand = (trimmed: string) => {
  const fencedMatches = [
    ...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi),
  ].map((match) => match[1] ?? "");
  const candidates = [
    ...fencedMatches,
    trimmed,
    ...extractJsonObjectCandidates(trimmed),
  ]
    .map((value) => value.trim())
    .filter(
      (value, index, all) => value.length > 0 && all.indexOf(value) === index,
    );

  let selectedCommand: ChatStreamCommand | null = null;
  let selectedRawCandidate = "";

  for (const rawCandidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawCandidate.trim());
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.__type !== "chat.stream_signal" ||
      record.route !== "util_task" ||
      typeof record.stage !== "string"
    ) {
      continue;
    }

    const normalizedNonce =
      typeof record.nonce === "string" && record.nonce.trim().length > 0
        ? record.nonce.trim()
        : undefined;
    const normalizedContextText =
      typeof record.context_text === "string" &&
      record.context_text.trim().length > 0
        ? record.context_text.trim()
        : undefined;
    const normalizedPersistent = record.persistent === true;

    const stage = record.stage.trim();
    if (!stage || stage.includes("<") || stage.includes(">")) {
      continue;
    }

    const command: ChatStreamCommand = {
      __type: "chat.stream_signal",
      route: "util_task",
      stage,
      ...(normalizedNonce ? { nonce: normalizedNonce } : {}),
      ...(normalizedContextText ? { context_text: normalizedContextText } : {}),
      ...(normalizedPersistent ? { persistent: true } : {}),
    };

    selectedCommand = command;
    selectedRawCandidate = rawCandidate.trim();
  }

  if (!selectedCommand) {
    return null;
  }

  const cleanText = trimmed.replace(selectedRawCandidate, "").trim();
  return {
    command: selectedCommand,
    cleanText,
  };
};
