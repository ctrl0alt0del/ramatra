import type { LmStudioInputItem } from "@/lib/tasks/chat/input/types";
import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import type { TaskGroup } from "@/lib/tasks/types";

export type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export type CritiqueLmStudioOutput =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "reasoning";
      content: string;
    }
  | {
      type: "invalid_tool_call";
      reason: string;
    };

export type CritiqueChatResponse = {
  output?: CritiqueLmStudioOutput[];
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

export type RequestLmStudioChat = (args: {
  model: string;
  contextLength: number;
  input: string | LmStudioInputItem[];
  systemPrompt: string;
  stream?: boolean;
  integrations?: EphemeralMcpIntegration[];
}) => Promise<Response>;
