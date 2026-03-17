import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioOutput } from "@/lib/tasks/chat/output";
import type { TaskGroup } from "@/lib/tasks/types";

export type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export type RuntimeThreadSnapshot =
  | {
      id: string;
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: import("@/lib/chat/message-content").MessagePart[];
      }>;
      lmstudioResponseId: string | null;
      lmstudioModelInstanceId: string | null;
      conversationSummary: string | null;
      summaryCallsInCurrentRequest: number;
      contextWindowUsedTokens: number | null;
    }
  | null;

export type ChatResponse = {
  output?: LmStudioOutput[];
  response_id?: string;
  model_instance_id?: string;
  finish_reason?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  model?: string;
  error?: {
    message?: string;
  };
};

export type PendingChatStreamState = {
  stream: ReadableStream<Uint8Array>;
  promptMode: PromptMode;
  requestedContextLength: number;
  modelTarget: string;
  summaryCallsInCurrentRequest: number;
};
