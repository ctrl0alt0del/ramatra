"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SimpleImageAttachmentAdapter,
  useExternalStoreRuntime,
  useThreadListItemRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  type ExternalStoreAdapter,
  type ThreadMessage,
  type unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { parseCritiqueRequestMarker } from "@/lib/chat/critique-marker";
import type { MessagePart } from "@/lib/chat/message-content";
import { type PromptMode } from "@/lib/lmstudio/prompt-modes";

import type { ThreadApiDetail, ThreadApiSummary } from "./types";

type ThreadListItemRuntime = NonNullable<ReturnType<typeof useThreadListItemRuntime>>;

type ThreadMessageRepository = NonNullable<
  ExternalStoreAdapter<ThreadMessage>["messageRepository"]
>;

type SerializedChatMessage = {
  id?: string;
  role: "system" | "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; dataUrl: string; mimeType?: string; name?: string }
  >;
};

const assistantMetadataBase = {
  unstable_state: null,
  unstable_annotations: [],
  unstable_data: [],
  steps: [],
};

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

const waitForGeneratedThreadTitle = (remoteId: string, timeoutMs = 45000) => {
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

      const payload = JSON.parse(event.data) as { threads: ThreadApiSummary[] };
      const thread = payload.threads.find((item) => item.id === remoteId);
      if (!thread || !thread.titleGenerated) {
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

const looksLikeDbMessageId = (value: string | null): value is string => {
  if (!value) {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
};

const toUserTextParts = (
  parts: readonly { type: string; text?: string }[],
): Array<{ type: "text"; text: string }> => {
  const normalized = parts.flatMap((part) =>
    part.type === "text" && typeof part.text === "string"
      ? [{ type: "text" as const, text: part.text }]
      : [],
  );

  return normalized.length > 0 ? normalized : [{ type: "text", text: "" }];
};

const getTextContent = (message: ThreadMessage) => {
  return message.content
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n")
    .trim();
};

const toImageAttachment = (messageId: string, part: MessagePart, partIndex: number) => {
  if (part.type !== "image") {
    return [];
  }

  return [
    {
      id: `${messageId}-image-${partIndex}`,
      type: "image" as const,
      name: part.name ?? `image-${partIndex + 1}`,
      contentType: part.mimeType ?? "image/*",
      content: [{ type: "image" as const, image: part.dataUrl }],
      status: { type: "complete" as const },
      source: "message" as const,
    },
  ];
};

const storedMessageToThreadMessage = (
  storedMessage: ThreadApiDetail["messages"][number],
): ThreadMessage => {
  const id =
    storedMessage.role === "user" && storedMessage.messageUiId
      ? storedMessage.messageUiId
      : storedMessage.id;
  const textParts = storedMessage.content.flatMap((part) =>
    part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
  );
  const imageAttachments = storedMessage.content.flatMap((part, index) =>
    toImageAttachment(id, part, index),
  );

  if (storedMessage.role === "assistant") {
    return {
      id,
      role: "assistant",
      content: textParts,
      createdAt: new Date(),
      status: {
        type: "complete",
        reason: "stop",
      },
      metadata: {
        ...assistantMetadataBase,
        custom: { dbMessageId: id },
      },
    } as ThreadMessage;
  }

  if (storedMessage.role === "user") {
    return {
      id,
      role: "user",
      content: textParts,
      createdAt: new Date(),
      attachments: imageAttachments,
      metadata: {
        custom: { dbMessageId: id },
      },
    } as ThreadMessage;
  }

  return {
    id,
    role: "system",
    content: textParts.length > 0 ? textParts : [{ type: "text", text: "" }],
    createdAt: new Date(),
    metadata: {
      custom: { dbMessageId: id },
    },
  } as unknown as ThreadMessage;
};

const toRepository = (thread: ThreadApiDetail): ThreadMessageRepository => {
  return {
    headId: thread.activeLeafMessageId ?? thread.messages.at(-1)?.id ?? null,
    messages: thread.messages.map((message) => ({
      message: storedMessageToThreadMessage(message),
      parentId: message.parentMessageId ?? null,
    })),
  };
};

const toLinearRepository = (messages: readonly ThreadMessage[]): ThreadMessageRepository => {
  return {
    headId: messages.at(-1)?.id ?? null,
    messages: messages.map((message, index) => ({
      message,
      parentId: index === 0 ? null : messages[index - 1]?.id ?? null,
    })),
  };
};
const toActivePathMessages = (thread: ThreadApiDetail): ThreadMessage[] => {
  const byId = new Map(thread.messages.map((message) => [message.id, message]));

  const buildPath = (startId: string | null) => {
    if (!startId) {
      return [] as ThreadApiDetail["messages"];
    }

    const path: ThreadApiDetail["messages"] = [];
    let cursor: string | null = startId;

    while (cursor) {
      const message = byId.get(cursor);
      if (!message) {
        return [] as ThreadApiDetail["messages"];
      }

      path.push(message);
      cursor = message.parentMessageId ?? null;
    }

    path.reverse();
    return path;
  };

  const activeLeafPath = buildPath(thread.activeLeafMessageId ?? null);
  if (activeLeafPath.length > 0) {
    return activeLeafPath.map(storedMessageToThreadMessage);
  }

  const lastMessagePath = buildPath(thread.messages.at(-1)?.id ?? null);
  if (lastMessagePath.length > 0) {
    return lastMessagePath.map(storedMessageToThreadMessage);
  }

  const latestAssistant = [...thread.messages].reverse().find((message) => message.role === "assistant");
  const latestAssistantPath = buildPath(latestAssistant?.id ?? null);
  if (latestAssistantPath.length > 0) {
    return latestAssistantPath.map(storedMessageToThreadMessage);
  }

  if (thread.messages.length === 0) {
    return [];
  }

  const fallback = thread.messages[thread.messages.length - 1];
  return fallback ? [storedMessageToThreadMessage(fallback)] : [];
};


const getMessageDbIdCandidate = (message: ThreadMessage): string | null => {
  const metadataCustom =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>).custom
      : null;

  if (metadataCustom && typeof metadataCustom === "object") {
    const custom = metadataCustom as Record<string, unknown>;
    const candidates = [custom.dbMessageId, custom.messageId, custom.originalMessageId];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  return typeof message.id === "string" ? message.id : null;
};

const resolveDbIdFromLocal = (localId: string | null, localToDbMap: Map<string, string>) => {
  if (!localId) {
    return null;
  }

  const mapped = localToDbMap.get(localId) ?? null;
  if (looksLikeDbMessageId(mapped)) {
    return mapped;
  }

  return looksLikeDbMessageId(localId) ? localId : null;
};

const resolveEditingDbIdFromSourceId = (
  messages: readonly ThreadMessage[],
  sourceId: string | null,
  localToDbMap: Map<string, string>,
) => {
  if (!sourceId) {
    return null;
  }

  const fromMap = resolveDbIdFromLocal(sourceId, localToDbMap);
  if (fromMap) {
    return fromMap;
  }

  const sourceMessage = messages.find((message) => message.id === sourceId);
  if (!sourceMessage) {
    return null;
  }

  const fromModel = getMessageDbIdCandidate(sourceMessage);
  return looksLikeDbMessageId(fromModel) ? fromModel : null;
};

const sliceMessagesUntil = (messages: readonly ThreadMessage[], parentId: string | null) => {
  if (!parentId) {
    return [];
  }

  const index = messages.findIndex((message) => message.id === parentId);
  return index === -1 ? [...messages] : messages.slice(0, index + 1);
};

const withAssistantPlaceholder = (messages: readonly ThreadMessage[]) => {
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: [],
      createdAt: new Date(),
      status: {
        type: "running",
      },
      metadata: {
        ...assistantMetadataBase,
        custom: {},
      },
    } as ThreadMessage,
  ];
};

const setAssistantContent = (
  messages: readonly ThreadMessage[],
  content: Array<{ type: "text"; text: string } | { type: "reasoning"; text: string }>,
  isComplete: boolean,
) => {
  if (messages.length === 0) {
    return [...messages];
  }

  const next = [...messages];
  const last = next[next.length - 1];
  if (!last || last.role !== "assistant") {
    return [...messages];
  }

  next[next.length - 1] = {
    ...last,
    content,
    status: isComplete ? { type: "complete", reason: "stop" } : { type: "running" },
  } as ThreadMessage;

  return next;
};
const reconcileLatestAssistantAfterReload = (
  previousMessages: readonly ThreadMessage[],
  reloadedMessages: readonly ThreadMessage[],
  localToDbMap: Map<string, string>,
) => {
  const previousLast = previousMessages.at(-1);
  const reloadedLast = reloadedMessages.at(-1);

  if (!previousLast || !reloadedLast) {
    return [...reloadedMessages];
  }

  if (previousLast.role !== "assistant" || reloadedLast.role !== "assistant") {
    return [...reloadedMessages];
  }

  const previousText = getTextContent(previousLast);
  const reloadedText = getTextContent(reloadedLast);
  if (!previousText || !reloadedText || previousText !== reloadedText) {
    return [...reloadedMessages];
  }

  const reloadedDbId = getMessageDbIdCandidate(reloadedLast);
  if (reloadedDbId && looksLikeDbMessageId(reloadedDbId)) {
    localToDbMap.set(previousLast.id, reloadedDbId);
  }

  const preservedContent =
    previousLast.content.length > 0 ? previousLast.content : reloadedLast.content;

  const reloadedMetadata =
    reloadedLast.metadata && typeof reloadedLast.metadata === "object"
      ? (reloadedLast.metadata as Record<string, unknown>)
      : {};
  const reloadedCustom =
    reloadedMetadata.custom && typeof reloadedMetadata.custom === "object"
      ? (reloadedMetadata.custom as Record<string, unknown>)
      : {};

  const next = [...reloadedMessages];
  next[next.length - 1] = {
    ...reloadedLast,
    id: previousLast.id,
    content: preservedContent,
    status: {
      type: "complete",
      reason: "stop",
    },
    metadata: {
      ...reloadedMetadata,
      custom: {
        ...reloadedCustom,
        ...(reloadedDbId && looksLikeDbMessageId(reloadedDbId)
          ? { dbMessageId: reloadedDbId }
          : {}),
      },
    },
  } as ThreadMessage;

  return next;
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

const serializeMessageContent = async (message: ThreadMessage) => {
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
          (item) =>
            item.type === "image" &&
            typeof (item as { image?: unknown }).image === "string",
        ) as { image?: string } | undefined;

        const dataUrl = existingImage?.image ?? (attachment.file ? await fileToDataUrl(attachment.file) : null);
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

const serializeMessagesForApi = async (
  messages: readonly ThreadMessage[],
): Promise<SerializedChatMessage[]> => {
  return Promise.all(
    messages.map(async (message) => ({
      id: typeof message.id === "string" ? message.id : undefined,
      role: message.role,
      content: await serializeMessageContent(message),
    })),
  );
};

const getLatestUserMessage = (messages: readonly ThreadMessage[]) => {
  return [...messages].reverse().find((message) => message.role === "user") ?? null;
};

const getLatestUserMessageId = (messages: readonly ThreadMessage[]) => {
  return getLatestUserMessage(messages)?.id ?? null;
};

const getEditingMessageIdForParent = (
  messages: readonly ThreadMessage[],
  parentId: string | null,
) => {
  const resolveFromCandidate = (candidate: ThreadMessage | undefined) => {
    if (!candidate || candidate.role !== "user") {
      return null;
    }

    const dbIdFromModel = getMessageDbIdCandidate(candidate);
    if (looksLikeDbMessageId(dbIdFromModel)) {
      return dbIdFromModel;
    }

    return candidate.id ?? null;
  };

  if (parentId === null) {
    const rootUser = messages.find((message) => message.role === "user");
    return resolveFromCandidate(rootUser);
  }

  const parentIndex = messages.findIndex((message) => message.id === parentId);
  if (parentIndex === -1) {
    return null;
  }

  const candidate = messages[parentIndex + 1];
  return resolveFromCandidate(candidate);
};


function usePersistedChatRuntime(promptMode: PromptMode, moodId: string | null) {
  const attachmentAdapter = useMemo(() => new SimpleImageAttachmentAdapter(), []);
  const threadListItem = useThreadListItemRuntime();

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const localToDbMessageIdRef = useRef<Map<string, string>>(new Map());
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const hasPendingOptimisticRequestRef = useRef(false);
  const messagesRef = useRef<ThreadMessage[]>([]);

  const applyLocalMessages = useCallback(
    (
      next:
        | ThreadMessage[]
        | ((previous: ThreadMessage[]) => ThreadMessage[]),
    ) => {
      setMessages((previous) =>
        typeof next === "function"
          ? (next as (previous: ThreadMessage[]) => ThreadMessage[])(previous)
          : next,
      );
    },
    [],
  );

  const applyDbMessageIdToLocalModel = useCallback(
    (localMessageId: string, dbMessageId: string) => {
      applyLocalMessages((previous) =>
        previous.map((message) => {
          if (message.id !== localMessageId) {
            return message;
          }

          const metadata =
            message.metadata && typeof message.metadata === "object"
              ? (message.metadata as Record<string, unknown>)
              : {};
          const custom =
            metadata.custom && typeof metadata.custom === "object"
              ? (metadata.custom as Record<string, unknown>)
              : {};

          return {
            ...message,
            metadata: {
              ...metadata,
              custom: {
                ...custom,
                dbMessageId,
              },
            },
          } as ThreadMessage;
        }),
      );
    },
    [applyLocalMessages],
  );

  const loadThread = useCallback(async () => {
    const remoteId = threadListItem.getState().remoteId;
    if (!remoteId) {
      setMessages([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/threads/${remoteId}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load thread history");
      }

      const data = (await response.json()) as { thread: ThreadApiDetail };
      const nextMessages = toActivePathMessages(data.thread);
      const reconciledMessages = reconcileLatestAssistantAfterReload(
        messagesRef.current,
        nextMessages,
        localToDbMessageIdRef.current,
      );
      const hasOptimisticUser = messagesRef.current.some((message) => message.role === "user");
      const shouldPreserveOptimisticState =
        hasPendingOptimisticRequestRef.current &&
        hasOptimisticUser &&
        reconciledMessages.length === 0;

      if (!shouldPreserveOptimisticState) {
        applyLocalMessages(reconciledMessages);
      }

      const nextMap = new Map<string, string>();
      for (const message of reconciledMessages) {
        const idCandidate = getMessageDbIdCandidate(message);
        if (
          typeof message.id === "string" &&
          message.id.trim().length > 0 &&
          idCandidate &&
          looksLikeDbMessageId(idCandidate)
        ) {
          nextMap.set(message.id, idCandidate);
        }
      }
      localToDbMessageIdRef.current = nextMap;
    } finally {
      setIsLoading(false);
    }
  }, [applyLocalMessages, threadListItem]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const queueAndStream = useCallback(
    async (
      sourceMessages: readonly ThreadMessage[],
      options: { parentMessageId: string | null; editingMessageId: string | null },
    ) => {
      const myRequestId = requestIdRef.current + 1;
      requestIdRef.current = myRequestId;

      requestAbortRef.current?.abort();
      const abortController = new AbortController();
      requestAbortRef.current = abortController;

      hasPendingOptimisticRequestRef.current = true;
      setIsRunning(true);
      applyLocalMessages(withAssistantPlaceholder(sourceMessages));

      let eventSource: EventSource | null = null;

      const fail = (error: string) => {
        if (requestIdRef.current !== myRequestId) {
          return;
        }

        applyLocalMessages((previous) =>
          setAssistantContent(previous, [{ type: "text", text: `Error: ${error}` }], true),
        );
        hasPendingOptimisticRequestRef.current = false;
        setIsRunning(false);
      };

      const complete = async () => {
        if (requestIdRef.current !== myRequestId) {
          return;
        }

        try {
          await loadThread();
        } catch {
          // Keep streamed UI if refresh fails.
        } finally {
          hasPendingOptimisticRequestRef.current = false;
          setIsRunning(false);
        }
      };

      try {
        const remoteThreadId = await resolveThreadRemoteId(threadListItem);
        const serializedMessages = await serializeMessagesForApi(sourceMessages);

        const latestUser = getLatestUserMessage(sourceMessages);
        const latestUserText = latestUser ? getTextContent(latestUser) : "";
        const critiqueMarker = parseCritiqueRequestMarker(latestUserText);

        const queueUrl = critiqueMarker ? "/api/chat/critique" : "/api/chat";
        const queuePayload = critiqueMarker
          ? {
              comfyTaskId: critiqueMarker.comfyTaskId,
              imageIndex: critiqueMarker.imageIndex,
              threadId: remoteThreadId,
              moodId,
              parentMessageId: options.parentMessageId,
            }
          : {
              messages: serializedMessages,
              threadId: remoteThreadId,
              promptMode,
              moodId,
              parentMessageId: options.parentMessageId,
              editingMessageId: options.editingMessageId,
            };

        const response = await fetch(queueUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(queuePayload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to queue assistant response");
        }

        const data = (await response.json()) as {
          taskId: string;
          threadId?: string;
          userMessageId?: string | null;
        };

        const latestUserLocalMessageId = getLatestUserMessageId(sourceMessages);
        if (
          latestUserLocalMessageId &&
          typeof data.userMessageId === "string" &&
          data.userMessageId.trim().length > 0
        ) {
          const persistedUserMessageId = data.userMessageId.trim();
          localToDbMessageIdRef.current.set(latestUserLocalMessageId, persistedUserMessageId);
          applyDbMessageIdToLocalModel(latestUserLocalMessageId, persistedUserMessageId);
        }

        if (typeof data.threadId === "string" && data.threadId !== remoteThreadId) {
          throw new Error("Thread identity mismatch while queueing assistant response.");
        }

        eventSource = new EventSource(`/api/chat/task/${data.taskId}/events`);
        let lastText = "";
        let lastReasoning = "";
        let lastOwnerTaskGroupId: string | null = null;

        eventSource.addEventListener("task", (event: MessageEvent<string>) => {
          if (requestIdRef.current !== myRequestId) {
            return;
          }

          const payload = JSON.parse(event.data) as
            | {
                status: "queued" | "running" | "completed";
                text: string;
                reasoning?: string;
                ownerTaskGroupId?: string;
              }
            | {
                status: "failed";
                error: string;
              };

          if (payload.status === "failed") {
            eventSource?.close();
            eventSource = null;
            fail(payload.error);
            return;
          }

          const ownerTaskGroupId =
            typeof payload.ownerTaskGroupId === "string" && payload.ownerTaskGroupId.trim().length > 0
              ? payload.ownerTaskGroupId
              : null;

          const ownerChanged =
            ownerTaskGroupId !== null &&
            lastOwnerTaskGroupId !== null &&
            ownerTaskGroupId !== lastOwnerTaskGroupId;

          const rawText = payload.text ?? "";
          const rawReasoning = payload.reasoning ?? "";

          const mergePrefixed = (prefix: string, value: string) => {
            if (!prefix) {
              return value;
            }

            return value.startsWith(prefix) ? value : `${prefix}${value}`;
          };

          const nextText =
            ownerChanged && !rawText.startsWith(lastText) ? mergePrefixed(lastText, rawText) : rawText;
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

          const content: Array<{ type: "text"; text: string } | { type: "reasoning"; text: string }> = [];
          if (nextReasoning) {
            content.push({ type: "reasoning", text: nextReasoning });
          }
          if (nextText) {
            content.push({ type: "text", text: nextText });
          }

          applyLocalMessages((previous) =>
            setAssistantContent(previous, content, payload.status === "completed"),
          );

          if (payload.status === "completed") {
            eventSource?.close();
            eventSource = null;
            void complete();
          }
        });

        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          fail("Chat stream connection failed");
        };

        abortController.signal.addEventListener(
          "abort",
          () => {
            eventSource?.close();
            eventSource = null;
            if (requestIdRef.current === myRequestId) {
              hasPendingOptimisticRequestRef.current = false;
              setIsRunning(false);
            }
          },
          { once: true },
        );
      } catch (error) {
        eventSource?.close();
        fail(error instanceof Error ? error.message : "Request failed");
      }
    },
    [applyDbMessageIdToLocalModel, loadThread, moodId, promptMode, threadListItem],
  );

  const adapter = useMemo<ExternalStoreAdapter<ThreadMessage>>(
    () => ({
      isRunning,
      isLoading,
      messages,
      setMessages: (nextMessages) => {
        applyLocalMessages([...nextMessages]);
      },
      onCancel: async () => {
        requestAbortRef.current?.abort();
      },
      onNew: async (message) => {
        const nextUserMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: toUserTextParts(message.content),
          attachments: message.attachments,
          createdAt: new Date(),
          metadata: {
            custom: {},
          },
        } as ThreadMessage;

        const nextMessages = [...messages, nextUserMessage];
        applyLocalMessages(nextMessages);

        const parentMessageId = resolveDbIdFromLocal(
          message.parentId ?? null,
          localToDbMessageIdRef.current,
        );

        await queueAndStream(nextMessages, {
          parentMessageId,
          editingMessageId: null,
        });
      },
      onEdit: async (message) => {
        const base = sliceMessagesUntil(messages, message.parentId ?? null);
        const editedMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: toUserTextParts(message.content),
          attachments: message.attachments,
          createdAt: new Date(),
          metadata: {
            custom: {},
          },
        } as ThreadMessage;

        const nextMessages = [...base, editedMessage];
        applyLocalMessages(nextMessages);

        const parentMessageId = resolveDbIdFromLocal(
          message.parentId ?? null,
          localToDbMessageIdRef.current,
        );

        const editingMessageId =
          resolveEditingDbIdFromSourceId(
            messages,
            message.sourceId ?? null,
            localToDbMessageIdRef.current,
          ) ??
          (() => {
            const editingMessageIdCandidate = getEditingMessageIdForParent(
              messages,
              message.parentId ?? null,
            );
            return resolveDbIdFromLocal(
              editingMessageIdCandidate,
              localToDbMessageIdRef.current,
            );
          })();

        await queueAndStream(nextMessages, {
          parentMessageId,
          editingMessageId,
        });
      },
      onReload: async (parentId) => {
        const base = sliceMessagesUntil(messages, parentId);
        const latestUser = getLatestUserMessage(base.length > 0 ? base : messages);

        if (!latestUser) {
          throw new Error("Cannot regenerate without a user message.");
        }

        const nextMessages =
          base.length > 0 && base[base.length - 1]?.role === "user"
            ? [...base]
            : [...base, latestUser];

        applyLocalMessages(nextMessages);

        const parentMessageId = resolveDbIdFromLocal(parentId, localToDbMessageIdRef.current);

        await queueAndStream(nextMessages, {
          parentMessageId,
          editingMessageId: null,
        });
      },
      adapters: {
        attachments: attachmentAdapter,
      },
    }),
    [applyLocalMessages, attachmentAdapter, isLoading, isRunning, messages, queueAndStream],
  );

  return useExternalStoreRuntime(adapter);
}

export function usePersistedRuntime(promptMode: PromptMode, moodId: string | null) {
  const adapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const response = await fetch("/api/threads", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load threads");
        }

        const data = (await response.json()) as { threads: ThreadApiSummary[] };
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Chat" }),
        });

        if (!response.ok) {
          throw new Error("Failed to create thread");
        }

        const data = (await response.json()) as { thread: ThreadApiDetail };
        return {
          remoteId: data.thread.id,
          externalId: localId,
        };
      },
      async fetch(remoteId) {
        const response = await fetch(`/api/threads/${remoteId}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to fetch thread");
        }

        const data = (await response.json()) as { thread: ThreadApiDetail };
        return {
          remoteId: data.thread.id,
          title: data.thread.title,
          status: data.thread.status,
        };
      },
      async rename(remoteId, title) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      },
      async archive(remoteId) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
      },
      async unarchive(remoteId) {
        await fetch(`/api/threads/${remoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
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
    }),
    [],
  );

  return useRemoteThreadListRuntime({
    runtimeHook: function UsePromptModeRuntimeHook() {
      return usePersistedChatRuntime(promptMode, moodId);
    },
    adapter,
  });
}


















