"use client";

import { useMemo } from "react";

import {
  SimpleImageAttachmentAdapter,
  useLocalRuntime,
  useThreadListItemRuntime,
  type ChatModelAdapter,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  type unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { type PromptMode } from "@/lib/lmstudio/prompt-modes";

import { PersistedHistoryProvider } from "./history";
import type { ThreadApiDetail, ThreadApiSummary } from "./types";

type ThreadListItemRuntime = NonNullable<
  ReturnType<typeof useThreadListItemRuntime>
>;

const resolveThreadRemoteId = async (threadListItem: ThreadListItemRuntime) => {
  const { remoteId } = threadListItem.getState();
  if (remoteId) {
    return remoteId;
  }

  const initialized = await threadListItem.initialize();
  return initialized.remoteId;
};

const normalizeIncomingTitle = (title: string | undefined) => {
  const normalized = title?.trim();
  return normalized ? normalized : null;
};

const waitForGeneratedThreadTitle = (
  remoteId: string,
  timeoutMs = 45000,
) => {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let eventSource: EventSource | null = null;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (eventSource) {
        eventSource.close();
      }
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => {
      finish(null);
    }, timeoutMs);

    eventSource = new EventSource("/api/threads/events");
    eventSource.addEventListener("threads", (event: MessageEvent<string>) => {
      if (settled) {
        return;
      }

      const payload = JSON.parse(event.data) as {
        threads: ThreadApiSummary[];
      };

      const thread = payload.threads.find((item) => item.id === remoteId);
      if (!thread) {
        return;
      }

      if (!thread.titleGenerated) {
        return;
      }

      const normalizedTitle = normalizeIncomingTitle(thread.title);
      if (!normalizedTitle || normalizedTitle === "New Chat") {
        return;
      }

      window.clearTimeout(timeoutId);
      finish(normalizedTitle);
    });

    eventSource.onerror = () => {
      window.clearTimeout(timeoutId);
      finish(null);
    };
  });
};

function usePersistedChatRuntime(promptMode: PromptMode, moodId: string | null) {
  const attachmentAdapter = useMemo(
    () => new SimpleImageAttachmentAdapter(),
    [],
  );
  const threadListItem = useThreadListItemRuntime();

  const modelAdapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const remoteThreadId = await resolveThreadRemoteId(threadListItem);
        const serializedMessages = await Promise.all(
          messages.map(async (message) => ({
            role: message.role,
            content: await serializeMessageContent(message),
          })),
        );

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: serializedMessages,
            threadId: remoteThreadId,
            promptMode,
            moodId,
          }),
          signal: abortSignal,
        });

        if (!response.ok) {
          throw new Error("Failed to queue assistant response");
        }

        const data = (await response.json()) as {
          taskId: string;
          threadId: string;
        };

        if (data.threadId !== remoteThreadId) {
          throw new Error("Thread identity mismatch while queueing assistant response.");
        }

        const eventSource = new EventSource(`/api/chat/task/${data.taskId}/events`);
        let lastText = "";
        let lastReasoning = "";
        let lastOwnerTaskGroupId: string | null = null;
        let done = false;
        const queue: Array<{
          content: Array<
            | { type: "text"; text: string }
            | { type: "reasoning"; text: string }
          >;
        }> = [];
        let notify:
          | (() => void)
          | null = null;

        const pushUpdate = (update: {
          content: Array<
            | { type: "text"; text: string }
            | { type: "reasoning"; text: string }
          >;
        }) => {
          queue.push(update);
          notify?.();
          notify = null;
        };

        const reportFailure = (message: string) => {
          pushUpdate({
            content: [
              {
                type: "text",
                text: `Error: ${message}`,
              },
            ],
          });
        };

        const markDone = () => {
          if (done) return;
          done = true;
          eventSource.close();
          notify?.();
          notify = null;
        };

        eventSource.addEventListener("task", (event: MessageEvent<string>) => {
          const payload = JSON.parse(event.data) as
            | {
                status: "queued" | "running" | "completed";
                text: string;
                reasoning?: string;
                summaryCallsInCurrentRequest?: number;
                ownerTaskGroupId?: string;
              }
            | {
                status: "failed";
                error: string;
              };

          if (payload.status === "failed") {
            reportFailure(payload.error);
            markDone();
            return;
          }

          const mergePrefixed = (prefix: string, value: string) => {
            if (!prefix) {
              return value;
            }

            return value.startsWith(prefix) ? value : `${prefix}${value}`;
          };

          const ownerTaskGroupId =
            typeof payload.ownerTaskGroupId === "string" &&
            payload.ownerTaskGroupId.trim().length > 0
              ? payload.ownerTaskGroupId
              : null;

          const ownerChanged =
            ownerTaskGroupId !== null &&
            lastOwnerTaskGroupId !== null &&
            ownerTaskGroupId !== lastOwnerTaskGroupId;

          const rawText = payload.text ?? "";
          const rawReasoning = payload.reasoning ?? "";

          const nextText =
            ownerChanged && !rawText.startsWith(lastText)
              ? mergePrefixed(lastText, rawText)
              : rawText;
          const nextReasoning =
            ownerChanged && !rawReasoning.startsWith(lastReasoning)
              ? mergePrefixed(lastReasoning, rawReasoning)
              : rawReasoning;

          if (
            nextReasoning === lastReasoning &&
            nextText === lastText &&
            payload.status !== "completed"
          ) {
            return;
          }

          lastReasoning = nextReasoning;
          lastText = nextText;
          lastOwnerTaskGroupId = ownerTaskGroupId;

          const content: Array<
            | { type: "text"; text: string }
            | { type: "reasoning"; text: string }
          > = [];

          if (nextReasoning) {
            content.push({
              type: "reasoning",
              text: nextReasoning,
            });
          }

          if (nextText) {
            content.push({
              type: "text",
              text: nextText,
            });
          }

          if (content.length > 0) {
            pushUpdate({ content });
          }

          if (payload.status === "completed") {
            markDone();
          }
        });

        eventSource.onerror = () => {
          reportFailure("Chat stream connection failed");
          markDone();
        };

        abortSignal.addEventListener(
          "abort",
          () => {
            markDone();
          },
          { once: true },
        );

        while (!done || queue.length > 0) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            continue;
          }

          const nextUpdate = queue.shift();
          if (nextUpdate) {
            yield nextUpdate;
          }
        }
      },
    }),
    [moodId, promptMode, threadListItem],
  );

  return useLocalRuntime(modelAdapter, {
    adapters: {
      attachments: attachmentAdapter,
    },
  });
}

const serializeMessageContent = async (message: {
  content: readonly { type: string; text?: string }[];
  attachments?: readonly {
    type?: string;
    contentType?: string;
    file?: File;
    content?: readonly { type?: string; image?: string }[];
    name?: string;
  }[];
}) => {
  const textParts = message.content.flatMap((part) =>
    part.type === "text" && typeof part.text === "string"
      ? [{ type: "text" as const, text: part.text }]
      : [],
  );

  const imageParts = (
    await Promise.all(
      (message.attachments ?? []).map(async (attachment) => {
        const mimeType = attachment.contentType ?? attachment.file?.type;

        if (
          attachment.type !== "image" &&
          !mimeType?.startsWith("image/") &&
          !attachment.content?.some((item) => item.type === "image")
        ) {
          return null;
        }

        const existingImage = attachment.content?.find(
          (item) => item.type === "image" && typeof item.image === "string",
        )?.image;

        const dataUrl =
          existingImage ??
          (attachment.file ? await fileToDataUrl(attachment.file) : null);

        if (!dataUrl) {
          return null;
        }

        return {
          type: "image" as const,
          dataUrl,
          mimeType,
          name: attachment.name,
        };
      }),
    )
  ).filter((part): part is NonNullable<typeof part> => part !== null);

  return [...textParts, ...imageParts];
};

const fileToDataUrl = async (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read attachment."));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read attachment."));
    };

    reader.readAsDataURL(file);
  });
};

export function usePersistedRuntime(
  promptMode: PromptMode,
  moodId: string | null,
) {
  const adapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const response = await fetch("/api/threads", {
          cache: "no-store",
        });
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
      async initialize(localId) {
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
          thread: ThreadApiDetail;
        };

        return {
          remoteId: data.thread.id,
          externalId: localId,
        };
      },
      async fetch(remoteId) {
        const response = await fetch(`/api/threads/${remoteId}`, {
          cache: "no-store",
        });
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
      async generateTitle(remoteId) {
        return createAssistantStream(async (controller) => {
          const title = await waitForGeneratedThreadTitle(remoteId);

          controller.appendText(title ?? "New Chat");
          controller.close();
        });
      },
      unstable_Provider: PersistedHistoryProvider,
    }),
    [moodId, promptMode],
  );

  return useRemoteThreadListRuntime({
    runtimeHook: function UsePromptModeRuntimeHook() {
      return usePersistedChatRuntime(promptMode, moodId);
    },
    adapter,
  });
}

