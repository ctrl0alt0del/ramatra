import type { MessagePart } from "@/lib/chat/message-content";

export type StoredThreadMessage = {
  id: string;
  parentMessageId?: string | null;
  messageUiId?: string | null;
  tokenLoad?: number;
  role: "system" | "user" | "assistant";
  content: MessagePart[];
};

export type ThreadApiSummary = {
  id: string;
  title: string;
  titleGenerated: boolean;
  status: "regular" | "archived";
  lmstudioResponseId: string | null;
  lmstudioModelInstanceId: string | null;
  lastPromptMode: "fast" | "regular" | "writer" | "roleplay" | "artist" | null;
  lastMoodId: string | null;
  conversationSummary: string | null;
  summaryUpdatedAt: string | null;
  summaryMessageCount: number;
  summaryCallCountTotal: number;
  summaryCallsInCurrentRequest: number;
  contextWindowUsedTokens: number | null;
  contextWindowTotalTokens: number | null;
};

export type ThreadApiDetail = ThreadApiSummary & {
  activeLeafMessageId: string | null;
  messages: StoredThreadMessage[];
};

export type ExportedHistoryItem = {
  message: {
    role: "system" | "user" | "assistant";
    content?: readonly { type: string; text?: string }[];
  };
};


