export type StoredThreadMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ThreadApiSummary = {
  id: string;
  title: string;
  status: "regular" | "archived";
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
