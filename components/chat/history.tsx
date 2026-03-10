"use client";

import { useMemo } from "react";

import { RuntimeAdapterProvider, useAui } from "@assistant-ui/react";

import type {
  ExportedHistoryItem,
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
  const textParts = [
    {
      type: "text" as const,
      text: storedMessage.content,
    },
  ] as const;

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
        attachments: [],
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

export function PersistedHistoryProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const aui = useAui();

  const history = useMemo(
    () => ({
      async load() {
        const { remoteId } = aui.threadListItem().getState();
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
      async append(item: ExportedHistoryItem) {
        const { remoteId } = await aui.threadListItem().initialize();
        const text = (item.message.content ?? [])
          .flatMap((part) =>
            part.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("\n\n")
          .trim();

        if (!text) return;

        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appendMessages: [
              {
                role: item.message.role,
                content: text,
              },
            ],
          }),
        });
      },
    }),
    [aui],
  );

  return (
    <RuntimeAdapterProvider adapters={{ history }}>
      {children}
    </RuntimeAdapterProvider>
  );
}
