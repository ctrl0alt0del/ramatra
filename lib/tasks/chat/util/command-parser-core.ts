import { parseBracketUtilCommand } from "@/lib/tasks/chat/util/command-parser-bracket";
import { parseJsonUtilCommand } from "@/lib/tasks/chat/util/command-parser-json";
import type {
  ChatStreamCommand,
  ParsedChatStreamCommand,
} from "@/lib/tasks/chat/util/command-parser.types";

export const parseUtilPromptFlags = (prompt: string) => {
  const isStateless = /(?:^|\s)@stateless\b/i.test(prompt);
  const isVisualOnly = /(?:^|\s)@visualonly\b/i.test(prompt);
  const normalizedPrompt = prompt
    .replace(/(?:^|\s)@stateless\b/gi, " ")
    .replace(/(?:^|\s)@visualonly\b/gi, " ")
    .trim();

  return {
    isStateless,
    isVisualOnly,
    prompt: normalizedPrompt,
  };
};

const parseChatStreamCommand = (text: string): ParsedChatStreamCommand => {
  const bracketCommand = parseBracketUtilCommand(text);
  if (bracketCommand) {
    return {
      ...bracketCommand,
      source: "text",
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      command: null as ChatStreamCommand | null,
      cleanText: text,
      source: "none",
    };
  }

  const jsonCommand = parseJsonUtilCommand(trimmed);
  if (jsonCommand) {
    return {
      command: jsonCommand.command,
      cleanText: jsonCommand.cleanText,
      source: "text",
    };
  }

  return {
    command: null as ChatStreamCommand | null,
    cleanText: text,
    source: "none",
  };
};

export const parseChatStreamCommandFromOutputs = ({
  text,
  reasoning,
  allowReasoningFallback = true,
}: {
  text: string;
  reasoning: string;
  allowReasoningFallback?: boolean;
}): {
  command: ChatStreamCommand | null;
  cleanText: string;
  source: "text" | "reasoning" | "none";
} => {
  const fromText = parseChatStreamCommand(text);
  if (fromText.command) {
    return fromText;
  }

  if (!allowReasoningFallback || reasoning.trim().length === 0) {
    return fromText;
  }

  const fromReasoning = parseChatStreamCommand(reasoning);
  if (fromReasoning.command) {
    return {
      command: fromReasoning.command,
      cleanText: text,
      source: "reasoning" as const,
    };
  }

  return fromText;
};
