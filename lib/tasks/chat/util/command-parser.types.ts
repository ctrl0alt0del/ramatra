export type ChatStreamCommand = {
  __type: "chat.stream_signal";
  route: "util_task";
  stage: string;
  context_text?: string;
  nonce?: string;
  persistent?: boolean;
  stateless?: boolean;
};

export type ParsedChatStreamCommand = {
  command: ChatStreamCommand | null;
  cleanText: string;
  source: "text" | "none";
};
