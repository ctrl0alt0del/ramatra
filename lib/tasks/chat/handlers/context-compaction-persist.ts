import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";

export const persistCollapsedThreadSummary = ({
  threadId,
  conversationSummary,
}: {
  threadId: string;
  conversationSummary: string;
}) => {
  const thread = threadRepository.getById(threadId);
  if (!thread) {
    return null;
  }

  return (
    threadRepository.updateById(thread.id, {
      conversationSummary,
      summaryUpdatedAt: new Date().toISOString(),
      summaryMessageCount: thread.messageCount,
      summaryCallCountTotal: thread.summaryCallCountTotal + 1,
      lmstudioResponseId: null,
      contextWindowUsedTokens: null,
    }) ?? threadRepository.getById(thread.id)
  );
};
