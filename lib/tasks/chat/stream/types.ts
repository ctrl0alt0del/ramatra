import type { LmStudioOutput } from "@/lib/tasks/chat/output";

export type StreamChatResponse = {
  output?: LmStudioOutput[];
  response_id?: string;
  model_instance_id?: string;
  finish_reason?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  error?: {
    message?: string;
  };
};
