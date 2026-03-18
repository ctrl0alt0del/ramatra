"use client";

import { useMemo } from "react";

import {
  RuntimeAdapterProvider,
  useThreadListItemRuntime,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";

import type { MessagePart } from "@/lib/chat/message-content";

import type { ThreadApiDetail, StoredThreadMessage } from "./types";

const toImageAttachment = (
  messageId: string,
  part: MessagePart,
  partIndex: number,
) => {
  if (part.type !== "image") {
    return [];
  }

  return [
    {
      id: `${messageId}-image-${partIndex}`,
      type: "image" as const,
      name: part.name ?? `image-${partIndex + 1}`,
      contentType: part.mimeType ?? "image/*",
      content: [
        {
          type: "image" as const,
          image: part.dataUrl,
        },
      ],
      status: {
        type: "complete" as const,
      },
      source: "message" as const,
    },
  ];
};

const toExportedMessage = (storedMessage: StoredThreadMessage) => {
  const id = storedMessage.id;
  const parentId = storedMessage.parentMessageId ?? null;
  const textParts = storedMessage.content.flatMap((part) =>
    part.type === "text"
      ? [
          {
            type: "text" as const,
            text: part.text,
          },
        ]
      : [],
  );

  const imageAttachments = storedMessage.content.flatMap((part, partIndex) =>
    toImageAttachment(id, part, partIndex),
  );

  if (storedMessage.role === "assistant") {
    return {
      message: {
        id,
        role: "assistant" as const,
        content: textParts,
        createdAt: new Date(),
        status: {
          type: "complete" as const,
          reason: "stop" as const,
        },
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: { dbMessageId: id },
        },
      },
      parentId,
    };
  }

  if (storedMessage.role === "user") {
    return {
      message: {
        id,
        role: "user" as const,
        content: textParts,
        createdAt: new Date(),
        attachments: imageAttachments,
        metadata: {
          custom: { dbMessageId: id },
        },
      },
      parentId,
    };
  }

  return {
    message: {
      id,
      role: "system" as const,
      content: textParts,
      createdAt: new Date(),
      metadata: {
        custom: {},
      },
    },
    parentId,
  };
};

export function PersistedHistoryProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const threadListItem = useThreadListItemRuntime();

  const history = useMemo(
    () => ({
      async load() {
        const { remoteId } = threadListItem.getState();
        if (!remoteId) {
          return { messages: [] };
        }

        const response = await fetch(`/api/threads/${remoteId}`);

        if (!response.ok) {
          throw new Error("Failed to load thread history");
        }

        const data = (await response.json()) as { thread: ThreadApiDetail };

        return {
          messages: data.thread.messages.map((storedMessage) =>
            toExportedMessage(storedMessage),
          ),
        };
      },
      async append() {
        // Chat persistence is server-owned through /api/chat and the chat runner.
      },
    }),
    [threadListItem],
  );

  return (
    <RuntimeAdapterProvider
      adapters={{ history: history as unknown as ThreadHistoryAdapter }}
    >
      {children}
    </RuntimeAdapterProvider>
  );
}

