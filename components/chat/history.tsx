"use client";

import { useMemo } from "react";

import { RuntimeAdapterProvider, useThreadListItemRuntime } from "@assistant-ui/react";

import type { MessagePart } from "@/lib/chat/message-content";

import type {
  ThreadApiDetail,
  StoredThreadMessage,
} from "./types";

const toExportedMessage = (
  remoteId: string,
  storedMessage: StoredThreadMessage,
  index: number,
) => {
  const id = `${remoteId}-${index}`;
  const parentId = index === 0 ? null : `${remoteId}-${index - 1}`;
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
    toImageAttachment(remoteId, index, part, partIndex),
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
          custom: {},
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
          custom: {},
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

const toImageAttachment = (
  remoteId: string,
  messageIndex: number,
  part: MessagePart,
  partIndex: number,
) => {
  if (part.type !== "image") {
    return [];
  }

  return [
    {
      id: `${remoteId}-${messageIndex}-image-${partIndex}`,
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
          messages: data.thread.messages.map((storedMessage, index) =>
            toExportedMessage(remoteId, storedMessage, index),
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
    <RuntimeAdapterProvider adapters={{ history: history as any }}>
      {children}
    </RuntimeAdapterProvider>
  );
}
