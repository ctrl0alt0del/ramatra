import { type ChatMessageRoleData } from "@lmstudio/sdk";

import {
  getTextFromMessageContent,
  parseStoredMessageContent,
  serializeMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { getDb } from "@/lib/db";
import { type PromptMode } from "@/lib/lmstudio/prompt-modes";
import {
  estimateImageTokens,
  estimateMessageTokens,
} from "@/lib/tasks/chat/policies/context-budget";
import { publishThreadChanged } from "@/lib/threads/event-bus";

export type ThreadMessage = {
  id?: string;
  parentMessageId?: string | null;
  lmstudioResponseId?: string | null;
  messageUiId?: string | null;
  tokenLoad?: number;
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
  lastMoodId: string | null;
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
  activeLeafMessageId: string | null;
  messages: ThreadMessage[];
};

type ThreadRow = {
  id: string;
  title: string;
  title_generated: number;
  status: ThreadSummary["status"];
  active_leaf_message_id: string | null;
  user_intent: string | null;
  lmstudio_response_id: string | null;
  lmstudio_model_instance_id: string | null;
  last_prompt_mode: PromptMode | null;
  last_mood_id: string | null;
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
  id: string;
  parent_message_id: string | null;
  lmstudio_response_id: string | null;
  message_ui_id: string | null;
  role: ThreadMessage["role"];
  content: string;
  token_load: number;
  created_at: string;
};

const db = getDb();

const computeMessageTokenLoad = (content: MessagePart[]) => {
  return estimateMessageTokens(content) + estimateImageTokens(content);
};

const getLatestMessageIdForThread = (threadId: string) => {
  const row = db
    .prepare(
      `
        SELECT id
        FROM messages
        WHERE thread_id = ?
        ORDER BY position DESC, created_at DESC
        LIMIT 1
      `,
    )
    .get(threadId) as { id: string } | undefined;
  return row?.id ?? null;
};

const getMessageNodeById = (messageId: string, threadId?: string) => {
  if (threadId) {
    return db
      .prepare(
        `
          SELECT id, parent_message_id, lmstudio_response_id, role
          FROM messages
          WHERE id = ?
            AND thread_id = ?
        `,
      )
      .get(messageId, threadId) as
      | {
        id: string;
        parent_message_id: string | null;
        lmstudio_response_id: string | null;
        role: ThreadMessage["role"];
      }
    | undefined;
  }

  return db
    .prepare(
      `
        SELECT id, parent_message_id, lmstudio_response_id, role
        FROM messages
        WHERE id = ?
      `,
    )
    .get(messageId) as
    | {
        id: string;
        parent_message_id: string | null;
        lmstudio_response_id: string | null;
        role: ThreadMessage["role"];
      }
    | undefined;
};

const getActiveBranchMessages = ({
  threadId,
  activeLeafMessageId,
}: {
  threadId: string;
  activeLeafMessageId: string | null;
}) => {
  const leafMessageId = activeLeafMessageId ?? getLatestMessageIdForThread(threadId);
  if (!leafMessageId) {
    return {
      messages: [] as MessageRow[],
      activeLeafMessageId: null,
    };
  }

  const rows = db
    .prepare(
      `
        WITH RECURSIVE branch AS (
          SELECT
            id,
            parent_message_id,
            lmstudio_response_id,
            message_ui_id,
            role,
            content,
            token_load,
            created_at,
            0 AS depth
          FROM messages
          WHERE id = ?

          UNION ALL

          SELECT
            m.id,
            m.parent_message_id,
            m.lmstudio_response_id,
            m.message_ui_id,
            m.role,
            m.content,
            m.token_load,
            m.created_at,
            branch.depth + 1 AS depth
          FROM messages m
          JOIN branch ON branch.parent_message_id = m.id
        )
        SELECT id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at
        FROM branch
        ORDER BY depth DESC
      `,
    )
    .all(leafMessageId) as MessageRow[];

  return {
    messages: rows,
    activeLeafMessageId: leafMessageId,
  };
};

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
    lastMoodId: thread.lastMoodId,
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
          t.active_leaf_message_id,
          t.user_intent,
          t.lmstudio_response_id,
          t.lmstudio_model_instance_id,
          t.last_prompt_mode,
          t.last_mood_id,
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
    lastMoodId: row.last_mood_id,
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
  lastMoodId?: string | null;
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
  const lastMoodId = input?.lastMoodId ?? null;
  const conversationSummary = input?.conversationSummary ?? null;
  const summaryUpdatedAt = input?.summaryUpdatedAt ?? null;
  const summaryMessageCount = input?.summaryMessageCount ?? 0;
  const summaryCallCountTotal = input?.summaryCallCountTotal ?? 0;
  const summaryCallsInCurrentRequest =
    input?.summaryCallsInCurrentRequest ?? 0;
  const contextWindowUsedTokens =
    input?.contextWindowUsedTokens ?? messages.reduce((sum, message) => sum + computeMessageTokenLoad(message.content), 0);
  const contextWindowTotalTokens = input?.contextWindowTotalTokens ?? null;

  const insert = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          title,
          title_generated,
          status,
          active_leaf_message_id,
          user_intent,
          lmstudio_response_id,
          lmstudio_model_instance_id,
          last_prompt_mode,
          last_mood_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      threadId,
      title,
      titleGenerated ? 1 : 0,
      status,
      null,
      userIntent,
      lmstudioResponseId,
      lmstudioModelInstanceId,
      lastPromptMode,
      lastMoodId,
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
        INSERT INTO messages (id, thread_id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    let parentMessageId: string | null = null;
    let activeLeafMessageId: string | null = null;
    for (const [index, message] of messages.entries()) {
      const messageId = crypto.randomUUID();
      const tokenLoad = computeMessageTokenLoad(message.content);
      insertMessage.run(
        messageId,
        threadId,
        parentMessageId,
        message.lmstudioResponseId ?? null,
        message.messageUiId ?? null,
          message.role,
        serializeMessageContent(message.content),
        tokenLoad,
        timestamp,
        index,
      );
      parentMessageId = messageId;
      activeLeafMessageId = messageId;
    }

    if (activeLeafMessageId) {
      db.prepare(
        `
          UPDATE threads
          SET active_leaf_message_id = ?
          WHERE id = ?
        `,
      ).run(activeLeafMessageId, threadId);
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


export const getThreadMessageById = (threadId: string, messageId: string) => {
  const row = db
    .prepare(
      `
        SELECT id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at
        FROM messages
        WHERE thread_id = ? AND id = ?
        LIMIT 1
      `,
    )
    .get(threadId, messageId) as MessageRow | undefined;

  if (!row) {
    return null;
  }

  const content = parseStoredMessageContent(row.content);
  const fallbackLoad = computeMessageTokenLoad(content);

  return {
      id: row.id,
      parentMessageId: row.parent_message_id,
      lmstudioResponseId: row.lmstudio_response_id,
      messageUiId: row.message_ui_id,
      role: row.role,
      content,
      tokenLoad: row.token_load > 0 ? row.token_load : fallbackLoad,
    } satisfies ThreadMessage;
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
          t.active_leaf_message_id,
          t.user_intent,
          t.lmstudio_response_id,
          t.lmstudio_model_instance_id,
          t.last_prompt_mode,
          t.last_mood_id,
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

  const branch = getActiveBranchMessages({
    threadId,
    activeLeafMessageId: thread.active_leaf_message_id,
  });

  const branchMessages = branch.messages.map((message) => {
    const content = parseStoredMessageContent(message.content);
    const fallbackLoad = computeMessageTokenLoad(content);
    return {
      id: message.id,
      parentMessageId: message.parent_message_id,
      messageUiId: message.message_ui_id,
      role: message.role,
      content,
      tokenLoad: message.token_load > 0 ? message.token_load : fallbackLoad,
    } satisfies ThreadMessage;
  });

  const branchTokenLoad = branchMessages.reduce(
    (sum, message) => sum + (message.tokenLoad ?? 0),
    0,
  );

  return {
    id: thread.id,
    title: thread.title,
    titleGenerated: thread.title_generated !== 0,
    status: thread.status,
    activeLeafMessageId: branch.activeLeafMessageId,
    userIntent: thread.user_intent,
    lmstudioResponseId: thread.lmstudio_response_id,
    lmstudioModelInstanceId: thread.lmstudio_model_instance_id,
    lastPromptMode: thread.last_prompt_mode,
    lastMoodId: thread.last_mood_id,
    conversationSummary: thread.conversation_summary,
    summaryUpdatedAt: thread.summary_updated_at,
    summaryMessageCount: thread.summary_message_count,
    summaryCallCountTotal: thread.summary_call_count_total,
    summaryCallsInCurrentRequest: thread.summary_calls_in_current_request,
    contextWindowUsedTokens: branchTokenLoad,
    contextWindowTotalTokens: thread.context_window_total_tokens,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messageCount: branchMessages.length,
    messages: branchMessages,
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
    lastMoodId?: string | null;
    conversationSummary?: string | null;
    summaryUpdatedAt?: string | null;
    summaryMessageCount?: number;
    summaryCallCountTotal?: number;
    summaryCallsInCurrentRequest?: number;
    contextWindowUsedTokens?: number | null;
    contextWindowTotalTokens?: number | null;
    appendMessages?: ThreadMessage[];
    appendParentMessageId?: string | null;
    replaceMessages?: ThreadMessage[];
    regenerateOfLastAssistant?: boolean;
    activeLeafMessageId?: string | null;
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
  const nextLastMoodId =
    input.lastMoodId !== undefined ? input.lastMoodId : existing.lastMoodId;
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
    let nextActiveLeafMessageId = existing.activeLeafMessageId;

    if (input.activeLeafMessageId !== undefined) {
      if (input.activeLeafMessageId === null) {
        nextActiveLeafMessageId = null;
      } else {
        const selectedLeaf = getMessageNodeById(input.activeLeafMessageId, threadId);
        if (selectedLeaf) {
          nextActiveLeafMessageId = selectedLeaf.id;
        }
      }
    }

    if (input.replaceMessages) {
      db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);

      const insertMessage = db.prepare(
        `
          INSERT INTO messages (id, thread_id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      let parentMessageId: string | null = null;
      nextActiveLeafMessageId = null;
      for (const [index, message] of input.replaceMessages.entries()) {
        const messageId = crypto.randomUUID();
        const tokenLoad = computeMessageTokenLoad(message.content);
        insertMessage.run(
          messageId,
          threadId,
          parentMessageId,
          message.lmstudioResponseId ?? null,
          message.messageUiId ?? null,
          message.role,
          serializeMessageContent(message.content),
          tokenLoad,
          timestamp,
          index,
        );
        parentMessageId = messageId;
        nextActiveLeafMessageId = messageId;
      }
    } else if (input.appendMessages?.length) {
      const currentPosition = db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS max_position FROM messages WHERE thread_id = ?`,
        )
        .get(threadId) as { max_position: number };

      let parentCursor = nextActiveLeafMessageId;
      if (input.appendParentMessageId !== undefined) {
        if (input.appendParentMessageId === null) {
          parentCursor = null;
        } else {
          const appendParentNode = getMessageNodeById(input.appendParentMessageId, threadId);
          if (appendParentNode) {
            parentCursor = appendParentNode.id;
          }
        }
      }

      if (input.regenerateOfLastAssistant === true && parentCursor) {
        const activeLeafNode = getMessageNodeById(parentCursor, threadId);
        if (activeLeafNode?.role === "assistant") {
          parentCursor = activeLeafNode.parent_message_id;
        }
      }

      const insertMessage = db.prepare(
        `
          INSERT INTO messages (id, thread_id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      for (const [index, message] of input.appendMessages.entries()) {
        const messageId = crypto.randomUUID();
        const tokenLoad = computeMessageTokenLoad(message.content);
        insertMessage.run(
          messageId,
          threadId,
          parentCursor,
          message.lmstudioResponseId ?? null,
          message.messageUiId ?? null,
          message.role,
          serializeMessageContent(message.content),
          tokenLoad,
          timestamp,
          currentPosition.max_position + index + 1,
        );
        parentCursor = messageId;
        nextActiveLeafMessageId = messageId;
      }
    }

    db.prepare(
      `
        UPDATE threads
        SET
          title = ?,
          title_generated = ?,
          status = ?,
          active_leaf_message_id = ?,
          user_intent = ?,
          lmstudio_response_id = ?,
          lmstudio_model_instance_id = ?,
          last_prompt_mode = ?,
          last_mood_id = ?,
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
      nextActiveLeafMessageId,
      nextUserIntent,
      nextLmstudioResponseId,
      nextLmstudioModelInstanceId,
      nextLastPromptMode,
      nextLastMoodId,
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



export const getThreadWithAllMessages = (threadId: string) => {
  const thread = getThread(threadId);
  if (!thread) {
    return null;
  }

  const rows = db
    .prepare(
      `
        SELECT id, parent_message_id, lmstudio_response_id, message_ui_id, role, content, token_load, created_at
        FROM messages
        WHERE thread_id = ?
        ORDER BY position ASC, created_at ASC
      `,
    )
    .all(threadId) as MessageRow[];

  const messages = rows.map((row) => {
    const content = parseStoredMessageContent(row.content);
    const fallbackLoad = computeMessageTokenLoad(content);
    return {
      id: row.id,
      parentMessageId: row.parent_message_id,
      lmstudioResponseId: row.lmstudio_response_id,
      messageUiId: row.message_ui_id,
      role: row.role,
      content,
      tokenLoad: row.token_load > 0 ? row.token_load : fallbackLoad,
    } satisfies ThreadMessage;
  });

  return {
    ...thread,
    messageCount: messages.length,
    messages,
  } satisfies ThreadDetail;
};


















export const resolvePreviousResponseIdFromParentMessage = (
  threadId: string,
  parentMessageId: string | null,
) => {
  let cursor = parentMessageId?.trim() ? parentMessageId.trim() : null;
  if (!cursor) {
    return null;
  }

  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor)) {
      return null;
    }
    visited.add(cursor);

    const node = getMessageNodeById(cursor, threadId);
    if (!node) {
      return null;
    }

    if (
      node.role === "assistant" &&
      typeof node.lmstudio_response_id === "string" &&
      node.lmstudio_response_id.trim().length > 0
    ) {
      return node.lmstudio_response_id.trim();
    }

    cursor = node.parent_message_id;
  }

  return null;
};
