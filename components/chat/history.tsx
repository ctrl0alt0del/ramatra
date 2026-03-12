"use client";

import { useMemo } from "react";

import { RuntimeAdapterProvider, useAui } from "@assistant-ui/react";

import { resolveRemoteThreadId } from "./runtime";
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
        const resolvedRemoteId = resolveRemoteThreadId(remoteId) ?? remoteId;
        if (!resolvedRemoteId || resolvedRemoteId.startsWith("__LOCALID_")) {
          return { messages: [] };
        }

        const response = await fetch(`/api/threads/${resolvedRemoteId}`);

        if (!response.ok) {
          throw new Error("Failed to load thread history");
        }

        const data = (await response.json()) as { thread: ThreadApiDetail };

        return {
          messages: data.thread.messages.map((storedMessage, index) =>
            toExportedMessage(resolvedRemoteId, storedMessage, index),
          ),
        };
      },
      async append() {
        // Chat persistence is server-owned through /api/chat and the chat runner.
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
