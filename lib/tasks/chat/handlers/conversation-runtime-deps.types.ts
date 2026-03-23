import type { LoadedLmStudioModelInstance } from "@/lib/lmstudio/models";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import type { LmStudioSamplingParams } from "@/lib/tasks/chat/policies/lmstudio-sampling";
import type { Task, TaskGroupPayloadMap } from "@/lib/tasks/types";
import type {
  ChatTask,
  PendingChatStreamState,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime-models";

export type ConversationRuntimeDeps = {
  getChatModelKey: () => string;
  ensureLmStudioModelLoaded: (args: {
    modelKey: string;
    contextLength: number;
  }) => Promise<{ instanceId: string }>;
  resolvePreferredLmStudioModelTarget: (args: {
    preferredInstanceId: string;
    modelKey: string;
  }) => Promise<string>;
  listLoadedLmStudioModels: () => Promise<LoadedLmStudioModelInstance[]>;
  isTransientLmStudioFetchError: (error: unknown) => boolean;
  formatLoadedLmStudioModelsForDebug: (
    models: LoadedLmStudioModelInstance[],
  ) => unknown;
  logChatModelDebug: (phase: string, payload: Record<string, unknown>) => void;
  requestLmStudioChat: (args: {
    model: string;
    contextLength: number;
    input: string | LmStudioInputItem[];
    previousResponseId?: string;
    systemPrompt: string;
    forceSystemPrompt?: boolean;
    integrations?: EphemeralMcpIntegration[];
    sampling?: LmStudioSamplingParams;
    stream?: boolean;
  }) => Promise<Response>;
  formatUnknownError: (error: unknown) => {
    name: string;
    message: string;
    stack: string | null;
  };
  buildIntegrations: (promptMode: PromptMode) => EphemeralMcpIntegration[];
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: import("@/lib/chat/message-content").MessagePart[];
      }>;
    } | null;
    currentUserMessage: import("@/lib/chat/message-content").MessagePart[];
  }) => string;
  persistConversationStreamResult: (args: {
    task: ChatTask;
    finalResponse: {
      response_id?: string | null;
      model_instance_id?: string | null;
      usage?: Record<string, unknown>;
      stats?: Record<string, unknown>;
    } | null;
    textWithCompactionMarkers: string;
    promptMode: PromptMode;
    moodId: string | null;
    requestedContextLength: number;
    continuationCount: number;
    compactThresholdRatio: number;
  }) => void;
  maybeEnqueueTitleGenerationTask: (threadId: string) => void;
  finalizeConversationViaStreamTask: (args: {
    taskId: string;
    text: string;
    reasoning: string;
    responseId: string | null;
    summaryCallsInCurrentRequest: number;
  }) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "pending" | "completed";
  }) => void;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: {
        text: string;
        reasoning: string;
        responseId: string | null;
        summaryCallsInCurrentRequest: number;
      };
    },
  ) => void;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
  updateThread: (
    threadId: string,
    patch:
      | { summaryCallsInCurrentRequest: number }
      | { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => unknown;
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
};

export type ConversationRuntimeContext = {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  thread: RuntimeThreadSnapshot;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  isPersistentConversation: boolean;
  compactThresholdRatio: number;
};
