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
      run({ messages, abortSignal, unstable_threadId }) {
        return createAssistantStream(async (controller) => {
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
            throw new Error("Failed to queue assistant response");
          }

          const data = (await response.json()) as {
            taskId: string;
          };

          const eventSource = new EventSource(`/api/chat/task/${data.taskId}/events`);

          const closeStream = () => {
            eventSource.close();
            controller.close();
          };

          const reportStreamError = (message: string) => {
            eventSource.close();
            const maybeErrorController = controller as {
              error?: (error: Error) => void;
            };
            if (maybeErrorController.error) {
              maybeErrorController.error(new Error(message));
              return;
            }
            controller.close();
          };

          const onTaskEvent = (event: MessageEvent<string>) => {
            const payload = JSON.parse(event.data) as
              | {
                  status: "queued" | "running" | "completed";
                  text: string;
                }
              | {
                  status: "failed";
                  error: string;
                };

            if (payload.status === "failed") {
              reportStreamError(payload.error);
              return;
            }

            if (payload.status === "completed") {
              if (payload.text) {
                controller.appendText(payload.text);
              }
              closeStream();
            }
          };

          eventSource.addEventListener("task", onTaskEvent);
          eventSource.onerror = () => {
            reportStreamError("Chat stream connection failed");
          };

          abortSignal.addEventListener(
            "abort",
            () => {
              eventSource.close();
              controller.close();
            },
            { once: true },
          );
        });
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
