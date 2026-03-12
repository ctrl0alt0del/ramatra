import type { MessagePart } from "@/lib/chat/message-content";

export type StoredThreadMessage = {
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
  lastPromptMode: "fast" | "regular" | "writer" | "artist" | null;
  conversationSummary: string | null;
  summaryUpdatedAt: string | null;
  summaryMessageCount: number;
};

export type ThreadApiDetail = ThreadApiSummary & {
  messages: StoredThreadMessage[];
};

export type ExportedHistoryItem = {
  message: {
    role: "system" | "user" | "assistant";
    content?: readonly { type: string; text?: string }[];
  };
};
