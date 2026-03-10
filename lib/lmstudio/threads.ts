import { type ChatMessageRoleData } from "@lmstudio/sdk";

import { getDb } from "@/lib/db";

export type ThreadMessage = {
  role: Exclude<ChatMessageRoleData, "tool">;
  content: string;
};

export type ThreadSummary = {
  id: string;
  title: string;
  status: "regular" | "archived";
  lmstudioResponseId: string | null;
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
  status: ThreadSummary["status"];
  lmstudio_response_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type MessageRow = {
  role: ThreadMessage["role"];
  content: string;
};

const db = getDb();

const deriveTitle = (messages: ThreadMessage[]) => {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const source = firstUserMessage?.content.trim() || "New Chat";
  return source.slice(0, 60);
};

export const listThreads = (): ThreadSummary[] => {
  const rows = db
    .prepare(
      `
        SELECT
          t.id,
          t.title,
          t.status,
          t.lmstudio_response_id,
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
    status: row.status,
    lmstudioResponseId: row.lmstudio_response_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  }));
};

export const createThread = (input?: {
  title?: string;
  status?: ThreadSummary["status"];
  messages?: ThreadMessage[];
}) => {
  const messages = input?.messages ?? [];
  const threadId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const title = input?.title?.trim() || deriveTitle(messages);
  const status = input?.status ?? "regular";

  const insert = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO threads (id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    ).run(threadId, title, status, timestamp, timestamp);

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
        message.content,
        timestamp,
        index,
      );
    }
  });

  insert();
  return getThread(threadId)!;
};

export const getThread = (threadId: string) => {
  const thread = db
    .prepare(
      `
        SELECT
          t.id,
          t.title,
          t.status,
          t.lmstudio_response_id,
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
    status: thread.status,
    lmstudioResponseId: thread.lmstudio_response_id,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messageCount: thread.message_count,
    messages,
  } satisfies ThreadDetail;
};

export const updateThread = (
  threadId: string,
  input: {
    title?: string;
    status?: ThreadSummary["status"];
    lmstudioResponseId?: string | null;
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
      : !existing.title || existing.title === "New Chat"
        ? deriveTitle(nextMessages)
        : existing.title;
  const nextStatus = input.status ?? existing.status;
  const nextLmstudioResponseId =
    input.lmstudioResponseId !== undefined
      ? input.lmstudioResponseId
      : existing.lmstudioResponseId;

  const timestamp = new Date().toISOString();

  const update = db.transaction(() => {
    db.prepare(
      `
        UPDATE threads
        SET title = ?, status = ?, lmstudio_response_id = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(nextTitle, nextStatus, nextLmstudioResponseId, timestamp, threadId);

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
          message.content,
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
          message.content,
          timestamp,
          currentPosition.max_position + index + 1,
        );
      }
    }
  });

  update();
  return getThread(threadId);
};

export const deleteThread = (threadId: string) => {
  const result = db.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
  return result.changes > 0;
};
