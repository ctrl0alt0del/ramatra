"use client";

import { useMemo } from "react";

import {
  useLocalRuntime,
  type ChatModelAdapter,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  type unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { type PromptMode } from "@/lib/lmstudio/prompt-modes";

import { PersistedHistoryProvider } from "./history";
import type { ThreadApiDetail, ThreadApiSummary } from "./types";

function usePersistedChatRuntime(promptMode: PromptMode) {
  const modelAdapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages, abortSignal, unstable_threadId }) {
        const serializedMessages = messages.map((message) => ({
          role: message.role,
          content: message.content
            .flatMap((part) =>
              part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
            ),
        }));

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: serializedMessages,
            threadId: unstable_threadId,
            promptMode,
          }),
          signal: abortSignal,
        });

        if (!response.ok) {
          throw new Error("Failed to generate assistant response");
        }

        const data = (await response.json()) as {
          text: string;
          reasoning?: string;
        };

        return {
          content: [
            ...(data.reasoning?.trim()
              ? [
                  {
                    type: "reasoning" as const,
                    text: data.reasoning,
                  },
                ]
              : []),
            {
              type: "text" as const,
              text: data.text,
            },
          ],
        };
      },
    }),
    [promptMode],
  );

  return useLocalRuntime(modelAdapter);
}

export function usePersistedRuntime(promptMode: PromptMode) {
  const adapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const response = await fetch("/api/threads");
        if (!response.ok) {
          throw new Error("Failed to load threads");
        }

        const data = (await response.json()) as {
          threads: ThreadApiSummary[];
        };

        return {
          threads: data.threads.map((thread) => ({
            remoteId: thread.id,
            title: thread.title,
            status: thread.status,
          })),
        };
      },
      async initialize(threadId) {
        const response = await fetch("/api/threads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "New Chat",
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create thread");
        }

        const data = (await response.json()) as {
          thread: { id: string };
        };

        return {
          remoteId: data.thread.id,
          externalId: threadId,
        };
      },
      async fetch(remoteId) {
        const response = await fetch(`/api/threads/${remoteId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch thread");
        }

        const data = (await response.json()) as {
          thread: ThreadApiDetail;
        };

        return {
          remoteId: data.thread.id,
          title: data.thread.title,
          status: data.thread.status,
        };
      },
      async rename(remoteId, title) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title }),
        });
      },
      async archive(remoteId) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "archived" }),
        });
      },
      async unarchive(remoteId) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "regular" }),
        });
      },
      async delete(remoteId) {
        const response = await fetch(`/api/threads/${remoteId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete thread");
        }
      },
      async generateTitle(remoteId, messages) {
        return createAssistantStream(async (controller) => {
          const firstUserMessage = messages.find(
            (message) => message.role === "user",
          );
          const firstTextPart = firstUserMessage?.content.find(
            (part) => part.type === "text",
          );
          const title = firstTextPart?.text?.trim().slice(0, 60) || "New Chat";

          await fetch(`/api/threads/${remoteId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title }),
          });

          controller.appendText(title);
          controller.close();
        });
      },
      unstable_Provider: PersistedHistoryProvider,
    }),
    [],
  );

  return useRemoteThreadListRuntime({
    runtimeHook: function UsePromptModeRuntimeHook() {
      return usePersistedChatRuntime(promptMode);
    },
    adapter,
  });
}
