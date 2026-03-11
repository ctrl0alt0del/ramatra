export type StoredThreadMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ThreadApiSummary = {
  id: string;
  title: string;
  status: "regular" | "archived";
  lmstudioResponseId: string | null;
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
