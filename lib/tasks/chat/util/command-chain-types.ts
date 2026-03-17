import type { ChatStreamCommand } from "@/lib/tasks/chat/util-commands";

export type ParsedUtilCommandResult = {
  command: ChatStreamCommand | null;
  cleanText: string;
  source: "text" | "reasoning" | "none";
};
