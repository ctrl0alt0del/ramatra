import { type ChatMessageRoleData } from "@lmstudio/sdk";

import {
  getTextFromMessageContent,
  parseStoredMessageContent,
  serializeMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { getDb } from "@/lib/db";
import { type PromptMode } from "@/lib/lmstudio/prompt-modes";
import { publishThreadChanged } from "@/lib/threads/event-bus";

export type ThreadMessage = {
  role: Exclude<ChatMessageRoleData, "tool">;
  content: MessagePart[];
};

export type ThreadSummary = {
  id: string;
  title: string;
  titleGenerated: boolean;
  status: "regular" | "archived";
  userIntent: string | null;
  lmstudioResponseId: string | null;
  lmstudioModelInstanceId: string | null;
  lastPromptMode: PromptMode | null;
  conversationSummary: string | null;
  summaryUpdatedAt: string | null;
  summaryMessageCount: number;
  summaryCallCountTotal: number;
  summaryCallsInCurrentRequest: number;
  contextWindowUsedTokens: number | null;
  contextWindowTotalTokens: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type ThreadDetail = ThreadSummary & {
  messages: ThreadMessage[];
};

type ThreadRow = {
  id: string;
  title: string;
  title_generated: number;
  status: ThreadSummary["status"];
  user_intent: string | null;
  lmstudio_response_id: string | null;
  lmstudio_model_instance_id: string | null;
  last_prompt_mode: PromptMode | null;
  conversation_summary: string | null;
  summary_updated_at: string | null;
  summary_message_count: number;
  summary_call_count_total: number;
  summary_calls_in_current_request: number;
  context_window_used_tokens: number | null;
  context_window_total_tokens: number | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type MessageRow = {
  role: ThreadMessage["role"];
  content: string;
};

const db = getDb();

export const isPlaceholderThreadTitle = (title: string | null | undefined) => {
  const normalized = title?.trim().toLowerCase() ?? "";
  return normalized.length === 0 || normalized === "new chat";
};

const toThreadSummary = (thread: ThreadDetail): ThreadSummary => {
  return {
    id: thread.id,
    title: thread.title,
    titleGenerated: thread.titleGenerated,
    status: thread.status,
    userIntent: thread.userIntent,
    lmstudioResponseId: thread.lmstudioResponseId,
    lmstudioModelInstanceId: thread.lmstudioModelInstanceId,
    lastPromptMode: thread.lastPromptMode,
    conversationSummary: thread.conversationSummary,
    summaryUpdatedAt: thread.summaryUpdatedAt,
    summaryMessageCount: thread.summaryMessageCount,
    summaryCallCountTotal: thread.summaryCallCountTotal,
    summaryCallsInCurrentRequest: thread.summaryCallsInCurrentRequest,
    contextWindowUsedTokens: thread.contextWindowUsedTokens,
    contextWindowTotalTokens: thread.contextWindowTotalTokens,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messageCount,
  };
};

const deriveTitle = (messages: ThreadMessage[]) => {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const source = firstUserMessage
    ? getTextFromMessageContent(firstUserMessage.content).trim()
    : "";
  return (source || "New Chat").slice(0, 60);
};

export const listThreads = (): ThreadSummary[] => {
  const rows = db
    .prepare(
      `
        SELECT
          t.id,
          t.title,
          t.title_generated,
          t.status,
          t.user_intent,
          t.lmstudio_response_id,
          t.lmstudio_model_instance_id,
          t.last_prompt_mode,
          t.conversation_summary,
          t.summary_updated_at,
          t.summary_message_count,
          t.summary_call_count_total,
          t.summary_calls_in_current_request,
          t.context_window_used_tokens,
          t.context_window_total_tokens,
          t.created_at,
          t.updated_at,
          COUNT(m.id) AS message_count
        FROM threads t
        LEFT JOIN messages m ON m.thread_id = t.id
        GROUP BY t.id
        ORDER BY t.updated_at DESC
      `,
    )
    .all() as ThreadRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    titleGenerated: row.title_generated !== 0,
    status: row.status,
    userIntent: row.user_intent,
    lmstudioResponseId: row.lmstudio_response_id,
    lmstudioModelInstanceId: row.lmstudio_model_instance_id,
    lastPromptMode: row.last_prompt_mode,
    conversationSummary: row.conversation_summary,
    summaryUpdatedAt: row.summary_updated_at,
    summaryMessageCount: row.summary_message_count,
    summaryCallCountTotal: row.summary_call_count_total,
    summaryCallsInCurrentRequest: row.summary_calls_in_current_request,
    contextWindowUsedTokens: row.context_window_used_tokens,
    contextWindowTotalTokens: row.context_window_total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  }));
};

export const createThread = (input?: {
  title?: string;
  titleGenerated?: boolean;
  status?: ThreadSummary["status"];
  lmstudioResponseId?: string | null;
  lmstudioModelInstanceId?: string | null;
  userIntent?: string | null;
  lastPromptMode?: PromptMode | null;
  conversationSummary?: string | null;
  summaryUpdatedAt?: string | null;
  summaryMessageCount?: number;
  summaryCallCountTotal?: number;
  summaryCallsInCurrentRequest?: number;
  contextWindowUsedTokens?: number | null;
  contextWindowTotalTokens?: number | null;
  messages?: ThreadMessage[];
}) => {
  const messages = input?.messages ?? [];
  const threadId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const title = input?.title?.trim() || deriveTitle(messages);
  const titleGenerated =
    input?.titleGenerated ?? !isPlaceholderThreadTitle(title);
  const status = input?.status ?? "regular";
  const lmstudioResponseId = input?.lmstudioResponseId ?? null;
  const lmstudioModelInstanceId = input?.lmstudioModelInstanceId ?? null;
  const userIntent = input?.userIntent ?? null;
  const lastPromptMode = input?.lastPromptMode ?? null;
  const conversationSummary = input?.conversationSummary ?? null;
  const summaryUpdatedAt = input?.summaryUpdatedAt ?? null;
  const summaryMessageCount = input?.summaryMessageCount ?? 0;
  const summaryCallCountTotal = input?.summaryCallCountTotal ?? 0;
  const summaryCallsInCurrentRequest =
    input?.summaryCallsInCurrentRequest ?? 0;
  const contextWindowUsedTokens = input?.contextWindowUsedTokens ?? null;
  const contextWindowTotalTokens = input?.contextWindowTotalTokens ?? null;

  const insert = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          title,
          title_generated,
          status,
          user_intent,
          lmstudio_response_id,
          lmstudio_model_instance_id,
          last_prompt_mode,
          conversation_summary,
          summary_updated_at,
          summary_message_count,
          summary_call_count_total,
          summary_calls_in_current_request,
          context_window_used_tokens,
          context_window_total_tokens,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      threadId,
      title,
      titleGenerated ? 1 : 0,
      status,
      userIntent,
      lmstudioResponseId,
      lmstudioModelInstanceId,
      lastPromptMode,
      conversationSummary,
      summaryUpdatedAt,
      summaryMessageCount,
      summaryCallCountTotal,
      summaryCallsInCurrentRequest,
      contextWindowUsedTokens,
      contextWindowTotalTokens,
      timestamp,
      timestamp,
    );

    const insertMessage = db.prepare(
      `
        INSERT INTO messages (id, thread_id, role, content, created_at, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    );

    for (const [index, message] of messages.entries()) {
      insertMessage.run(
        crypto.randomUUID(),
        threadId,
        message.role,
        serializeMessageContent(message.content),
        timestamp,
        index,
      );
    }
  });

  insert();
  const createdThread = getThread(threadId)!;
  publishThreadChanged({
    change: "created",
    threadId,
    thread: toThreadSummary(createdThread),
  });
  return createdThread;
};

export const getThread = (threadId: string) => {
  const thread = db
    .prepare(
      `
        SELECT
          t.id,
          t.title,
          t.title_generated,
          t.status,
          t.user_intent,
          t.lmstudio_response_id,
          t.lmstudio_model_instance_id,
          t.last_prompt_mode,
          t.conversation_summary,
          t.summary_updated_at,
          t.summary_message_count,
          t.summary_call_count_total,
          t.summary_calls_in_current_request,
          t.context_window_used_tokens,
          t.context_window_total_tokens,
          t.created_at,
          t.updated_at,
          COUNT(m.id) AS message_count
        FROM threads t
        LEFT JOIN messages m ON m.thread_id = t.id
        WHERE t.id = ?
        GROUP BY t.id
      `,
    )
    .get(threadId) as ThreadRow | undefined;

  if (!thread) return null;

  const messages = db
    .prepare(
      `
        SELECT role, content
        FROM messages
        WHERE thread_id = ?
        ORDER BY position ASC
      `,
    )
    .all(threadId) as MessageRow[];

  return {
    id: thread.id,
    title: thread.title,
    titleGenerated: thread.title_generated !== 0,
    status: thread.status,
    userIntent: thread.user_intent,
    lmstudioResponseId: thread.lmstudio_response_id,
    lmstudioModelInstanceId: thread.lmstudio_model_instance_id,
    lastPromptMode: thread.last_prompt_mode,
    conversationSummary: thread.conversation_summary,
    summaryUpdatedAt: thread.summary_updated_at,
    summaryMessageCount: thread.summary_message_count,
    summaryCallCountTotal: thread.summary_call_count_total,
    summaryCallsInCurrentRequest: thread.summary_calls_in_current_request,
    contextWindowUsedTokens: thread.context_window_used_tokens,
    contextWindowTotalTokens: thread.context_window_total_tokens,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messageCount: thread.message_count,
    messages: messages.map((message) => ({
      role: message.role,
      content: parseStoredMessageContent(message.content),
    })),
  } satisfies ThreadDetail;
};

export const updateThread = (
  threadId: string,
  input: {
    title?: string;
    titleGenerated?: boolean;
    status?: ThreadSummary["status"];
    lmstudioResponseId?: string | null;
    lmstudioModelInstanceId?: string | null;
    userIntent?: string | null;
    lastPromptMode?: PromptMode | null;
    conversationSummary?: string | null;
    summaryUpdatedAt?: string | null;
    summaryMessageCount?: number;
    summaryCallCountTotal?: number;
    summaryCallsInCurrentRequest?: number;
    contextWindowUsedTokens?: number | null;
    contextWindowTotalTokens?: number | null;
    appendMessages?: ThreadMessage[];
    replaceMessages?: ThreadMessage[];
  },
) => {
  const existing = getThread(threadId);
  if (!existing) return null;

  const nextMessages = input.replaceMessages
    ? input.replaceMessages
    : [...existing.messages, ...(input.appendMessages ?? [])];

  const nextTitle =
    input.title !== undefined
      ? input.title.trim() || deriveTitle(nextMessages)
      : existing.title || deriveTitle(nextMessages);
  const nextTitleGenerated =
    input.titleGenerated !== undefined
      ? input.titleGenerated
      : input.title !== undefined
        ? !isPlaceholderThreadTitle(nextTitle)
        : existing.titleGenerated;
  const nextStatus = input.status ?? existing.status;
  const nextLmstudioResponseId =
    input.lmstudioResponseId !== undefined
      ? input.lmstudioResponseId
      : existing.lmstudioResponseId;
  const nextLmstudioModelInstanceId =
    input.lmstudioModelInstanceId !== undefined
      ? input.lmstudioModelInstanceId
      : existing.lmstudioModelInstanceId;
  const nextUserIntent =
    input.userIntent !== undefined ? input.userIntent : existing.userIntent;
  const nextLastPromptMode =
    input.lastPromptMode !== undefined
      ? input.lastPromptMode
      : existing.lastPromptMode;
  const nextConversationSummary =
    input.conversationSummary !== undefined
      ? input.conversationSummary
      : existing.conversationSummary;
  const nextSummaryUpdatedAt =
    input.summaryUpdatedAt !== undefined
      ? input.summaryUpdatedAt
      : existing.summaryUpdatedAt;
  const nextSummaryMessageCount =
    input.summaryMessageCount !== undefined
      ? input.summaryMessageCount
      : existing.summaryMessageCount;
  const nextSummaryCallCountTotal =
    input.summaryCallCountTotal !== undefined
      ? input.summaryCallCountTotal
      : existing.summaryCallCountTotal;
  const nextSummaryCallsInCurrentRequest =
    input.summaryCallsInCurrentRequest !== undefined
      ? input.summaryCallsInCurrentRequest
      : existing.summaryCallsInCurrentRequest;
  const nextContextWindowUsedTokens =
    input.contextWindowUsedTokens !== undefined
      ? input.contextWindowUsedTokens
      : existing.contextWindowUsedTokens;
  const nextContextWindowTotalTokens =
    input.contextWindowTotalTokens !== undefined
      ? input.contextWindowTotalTokens
      : existing.contextWindowTotalTokens;

  const timestamp = new Date().toISOString();

  const update = db.transaction(() => {
    db.prepare(
      `
        UPDATE threads
        SET
          title = ?,
          title_generated = ?,
          status = ?,
          user_intent = ?,
          lmstudio_response_id = ?,
          lmstudio_model_instance_id = ?,
          last_prompt_mode = ?,
          conversation_summary = ?,
          summary_updated_at = ?,
          summary_message_count = ?,
          summary_call_count_total = ?,
          summary_calls_in_current_request = ?,
          context_window_used_tokens = ?,
          context_window_total_tokens = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      nextTitle,
      nextTitleGenerated ? 1 : 0,
      nextStatus,
      nextUserIntent,
      nextLmstudioResponseId,
      nextLmstudioModelInstanceId,
      nextLastPromptMode,
      nextConversationSummary,
      nextSummaryUpdatedAt,
      nextSummaryMessageCount,
      nextSummaryCallCountTotal,
      nextSummaryCallsInCurrentRequest,
      nextContextWindowUsedTokens,
      nextContextWindowTotalTokens,
      timestamp,
      threadId,
    );

    if (input.replaceMessages) {
      db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
    }

    if (input.replaceMessages) {
      const insertMessage = db.prepare(
        `
          INSERT INTO messages (id, thread_id, role, content, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      );

      for (const [index, message] of input.replaceMessages.entries()) {
        insertMessage.run(
          crypto.randomUUID(),
          threadId,
          message.role,
          serializeMessageContent(message.content),
          timestamp,
          index,
        );
      }
      return;
    }

    if (input.appendMessages?.length) {
      const currentPosition = db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS max_position FROM messages WHERE thread_id = ?`,
        )
        .get(threadId) as { max_position: number };

      const insertMessage = db.prepare(
        `
          INSERT INTO messages (id, thread_id, role, content, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      );

      for (const [index, message] of input.appendMessages.entries()) {
        insertMessage.run(
          crypto.randomUUID(),
          threadId,
          message.role,
          serializeMessageContent(message.content),
          timestamp,
          currentPosition.max_position + index + 1,
        );
      }
    }
  });

  update();
  const updatedThread = getThread(threadId);
  if (updatedThread) {
    publishThreadChanged({
      change: "updated",
      threadId,
      thread: toThreadSummary(updatedThread),
    });
  }
  return updatedThread;
};

export const deleteThread = (threadId: string) => {
  const existing = getThread(threadId);
  const result = db.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
  if (result.changes > 0) {
    publishThreadChanged({
      change: "deleted",
      threadId,
      thread: existing ? toThreadSummary(existing) : null,
    });
    return true;
  }

  return false;
};

export const deleteAllThreads = () => {
  const existingThreads = listThreads();
  if (!existingThreads.length) {
    return { deletedCount: 0 };
  }

  db.prepare(`DELETE FROM threads`).run();

  for (const thread of existingThreads) {
    publishThreadChanged({
      change: "deleted",
      threadId: thread.id,
      thread,
    });
  }

  return { deletedCount: existingThreads.length };
};
