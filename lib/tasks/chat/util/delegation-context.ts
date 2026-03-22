import type { MessagePart } from "@/lib/chat/message-content";
import {
  encodeComfyJobMarker,
  extractComfyJobMarker,
} from "@/components/chat/comfy-marker";
import { parseUtilPromptFlags } from "@/lib/tasks/chat/util-commands";
import type { ChatStreamCommand } from "@/lib/tasks/chat/util/command-parser.types";

const MAX_VISUAL_MARKER_LINES = 12;

const buildVisualOnlyMarkerSnapshot = ({
  thread,
}: {
  thread: {
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: MessagePart[];
    }>;
  } | null;
}) => {
  if (!thread) {
    return "";
  }

  const markerLines: string[] = [];
  const seenMarkerKeys = new Set<string>();

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    let remainingText = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");

    if (!remainingText.trim()) {
      continue;
    }

    while (remainingText.length > 0) {
      const { cleanText, marker } = extractComfyJobMarker(remainingText);
      if (!marker) {
        break;
      }

      const key =
        typeof marker.jobId === "string" && marker.jobId.trim().length > 0
          ? `job:${marker.jobId.trim()}`
          : `task:${marker.taskId}`;
      if (!seenMarkerKeys.has(key)) {
        markerLines.push(encodeComfyJobMarker(marker));
        seenMarkerKeys.add(key);
      }

      if (markerLines.length >= MAX_VISUAL_MARKER_LINES) {
        return [
          "Recent generation markers (latest first):",
          ...markerLines,
        ].join("\n");
      }

      if (cleanText === remainingText) {
        break;
      }
      remainingText = cleanText;
    }
  }

  if (markerLines.length === 0) {
    return "";
  }

  return [
    "Recent generation markers (latest first):",
    ...markerLines,
  ].join("\n");
};

export const buildUtilDelegationContext = ({
  utilPrompt,
  command,
  utilUserMessageSeed,
  thread,
  buildUtilHistorySnapshot,
}: {
  utilPrompt: string;
  command: ChatStreamCommand;
  utilUserMessageSeed: MessagePart[];
  thread: {
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: MessagePart[];
    }>;
  } | null;
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: MessagePart[];
      }>;
    } | null;
    currentUserMessage: MessagePart[];
  }) => string;
}) => {
  const utilSystemPromptExt =
    typeof command.context_text === "string" ? command.context_text.trim() : "";
  const utilPromptFlags = parseUtilPromptFlags(utilPrompt);
  const utilHistorySnapshot = buildUtilHistorySnapshot({
    thread,
    currentUserMessage: utilUserMessageSeed,
  });
  const useVisualOnlyContext =
    command.visualonly === true || utilPromptFlags.isVisualOnly;
  const useStatelessContext =
    useVisualOnlyContext ||
    command.stateless === true ||
    utilPromptFlags.isStateless;
  const visualOnlyMarkerSnapshot = useVisualOnlyContext
    ? buildVisualOnlyMarkerSnapshot({ thread })
    : "";
  const delegatedUserMessage = useStatelessContext ? [] : utilUserMessageSeed;
  const delegatedSystemPrompt = [
    utilSystemPromptExt,
    ...(useStatelessContext ? [] : [utilHistorySnapshot]),
    ...(useVisualOnlyContext ? [visualOnlyMarkerSnapshot] : []),
    utilPromptFlags.prompt,
  ]
    .filter((value) => value.length > 0)
    .join("\n\n");

  return {
    useStatelessContext,
    useVisualOnlyContext,
    delegatedUserMessage,
    delegatedSystemPrompt,
    utilSystemPromptExt,
  };
};
