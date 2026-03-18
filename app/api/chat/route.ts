import { z } from "zod";

import {
  hasUsableMessageContent,
  serializeMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import {
  createThread,
  getThread,
  getThreadMessageById,
  getThreadWithAllMessages,
  updateThread,
} from "@/lib/lmstudio/threads";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const imagePartSchema = z.object({
  type: z.literal("image"),
  dataUrl: z.string(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.array(z.union([textPartSchema, imagePartSchema])).optional(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema),
  threadId: z.string().optional(),
  promptMode: z.string().optional(),
  moodId: z.string().nullable().optional(),
  parentMessageId: z.string().nullable().optional(),
  editingMessageId: z.string().nullable().optional(),
});

const toChatMessages = (messages: Array<z.infer<typeof messageSchema>>) => {
  return messages
    .map((message) => {
      const content = (message.content ?? []) as MessagePart[];
      if (!hasUsableMessageContent(content)) return null;

      return {
        role: message.role,
        content,
        messageUiId: message.id?.trim() ? message.id.trim() : null,
      };
    })
    .filter(
      (
        message,
      ): message is {
        role: "system" | "user" | "assistant";
        content: MessagePart[];
        messageUiId: string | null;
      } => {
        return message !== null;
      },
    );
};

const findParentByPayloadChain = (
  fullThreadMessages: Array<{
    id?: string;
    messageUiId?: string | null;
    role: "system" | "user" | "assistant";
    content: MessagePart[];
  }>,
  payloadMessages: Array<{
    role: "system" | "user" | "assistant";
    content: MessagePart[];
    messageUiId?: string | null;
  }>,
) => {
  if (payloadMessages.length < 2) {
    return null;
  }

  const parentCandidate = payloadMessages[payloadMessages.length - 2];
  if (!parentCandidate) {
    return null;
  }

  const serializedCandidate = serializeMessageContent(parentCandidate.content);

  for (let index = fullThreadMessages.length - 1; index >= 0; index -= 1) {
    const message = fullThreadMessages[index];
    if (!message?.id) {
      continue;
    }

    if (message.role !== parentCandidate.role) {
      continue;
    }

    if (
      parentCandidate.messageUiId &&
      message.messageUiId === parentCandidate.messageUiId
    ) {
      return message.id;
    }

    if (serializeMessageContent(message.content) === serializedCandidate) {
      return message.id;
    }
  }

  return null;
};


const resolveMessageIdFromThread = (
  fullThread:
    | {
        messages: Array<{ id?: string; messageUiId?: string | null }>;
      }
    | null,
  candidateIdOrUiId: string | null,
) => {
  if (!fullThread || !candidateIdOrUiId) {
    return null;
  }

  const needle = candidateIdOrUiId.trim();
  if (!needle) {
    return null;
  }

  const byId = fullThread.messages.find((message) => message.id === needle);
  if (byId?.id) {
    return byId.id;
  }

  const byUiId = fullThread.messages.find(
    (message) => message.messageUiId === needle,
  );

  return byUiId?.id ?? null;
};

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid chat request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inputMessages = toChatMessages(parsed.data.messages);
  const latestInputMessage = inputMessages.at(-1) ?? null;
  const promptMode =
    parsed.data.promptMode && isPromptMode(parsed.data.promptMode)
      ? parsed.data.promptMode
      : defaultPromptMode;
  const latestUserMessage = [...inputMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return Response.json(
      { error: "Chat request must include a user message." },
      { status: 400 },
    );
  }

  const selectedParentMessageId = parsed.data.parentMessageId?.trim()
    ? parsed.data.parentMessageId.trim()
    : null;
  const selectedEditingMessageId = parsed.data.editingMessageId?.trim()
    ? parsed.data.editingMessageId.trim()
    : null;

  const requestedThreadId =
    parsed.data.threadId && !parsed.data.threadId.startsWith("__LOCALID_")
      ? parsed.data.threadId
      : undefined;
  const existingThread = requestedThreadId ? getThread(requestedThreadId) : null;
  const fullThread = requestedThreadId
    ? getThreadWithAllMessages(requestedThreadId)
    : null;

  const thread =
    existingThread ??
    createThread({
      title: "New Chat",
      messages: [
        {
          role: "user",
          content: latestUserMessage.content,
          messageUiId: latestUserMessage.messageUiId,
        },
      ],
    });

  const latestUserMessageSerialized = serializeMessageContent(
    latestUserMessage.content,
  );

  const selectedParentMessageIdIfExists = resolveMessageIdFromThread(
    fullThread,
    selectedParentMessageId,
  );
  const selectedEditingMessageIdIfExists = resolveMessageIdFromThread(
    fullThread,
    selectedEditingMessageId,
  );

  const inferredParentMessageId =
    fullThread && inputMessages.length > 1
      ? findParentByPayloadChain(fullThread.messages, inputMessages)
      : null;

  const inferredParentFromEditingMessageId =
    fullThread && selectedEditingMessageIdIfExists
      ? (fullThread.messages.find(
          (message) =>
            message.id === selectedEditingMessageIdIfExists &&
            message.role === "user",
        )?.parentMessageId ?? null)
      : null;

  const resolvedParentMessageId =
    selectedParentMessageIdIfExists ??
    inferredParentFromEditingMessageId ??
    inferredParentMessageId ??
    null;

  const selectedParentMessage =
    existingThread && resolvedParentMessageId
      ? getThreadMessageById(existingThread.id, resolvedParentMessageId)
      : null;

  const isReplayOfSelectedParentUser =
    latestInputMessage?.role === "user" &&
    selectedParentMessage?.role === "user" &&
    serializeMessageContent(selectedParentMessage.content) ===
      latestUserMessageSerialized;

  const activeLeafMessage = existingThread?.messages.at(-1) ?? null;
  const activeLeafParentUser =
    resolvedParentMessageId === null &&
    activeLeafMessage?.role === "assistant" &&
    activeLeafMessage.parentMessageId
      ? existingThread?.messages.find(
          (message) =>
            message.id === activeLeafMessage.parentMessageId &&
            message.role === "user",
        ) ?? null
      : null;

  const isReplayOfActiveLeafUser =
    latestInputMessage?.role === "user" &&
    activeLeafParentUser?.role === "user" &&
    serializeMessageContent(activeLeafParentUser.content) ===
      latestUserMessageSerialized;

  const isRegenerateRequest =
    Boolean(existingThread) &&
    (latestInputMessage?.role !== "user" ||
      isReplayOfSelectedParentUser ||
      isReplayOfActiveLeafUser);

  let persistedUserMessageId: string | null =
    thread.messages
      .slice()
      .reverse()
      .find((message) => message.role === "user")?.id ?? null;

  if (existingThread) {
    const lastMessage = existingThread.messages.at(-1);
    const parentDiffersFromActiveLeaf =
      resolvedParentMessageId !== null &&
      resolvedParentMessageId !== existingThread.activeLeafMessageId;

    const shouldAppendUserMessage =
      latestInputMessage?.role === "user" &&
      !isReplayOfSelectedParentUser &&
      !isReplayOfActiveLeafUser &&
      (parentDiffersFromActiveLeaf ||
        !lastMessage ||
        lastMessage.role !== "user" ||
        serializeMessageContent(lastMessage.content) !== latestUserMessageSerialized);

    if (shouldAppendUserMessage) {
      const updatedThreadAfterAppend = updateThread(existingThread.id, {
        appendParentMessageId: resolvedParentMessageId,
        appendMessages: [
          {
            role: "user",
            content: latestUserMessage.content,
            messageUiId: latestUserMessage.messageUiId,
          },
        ],
      });
      persistedUserMessageId =
        updatedThreadAfterAppend?.activeLeafMessageId ?? persistedUserMessageId;
    } else if (parentDiffersFromActiveLeaf) {
      const updatedThreadAfterLeafSwitch = updateThread(existingThread.id, {
        activeLeafMessageId: resolvedParentMessageId,
      });
      if (updatedThreadAfterLeafSwitch?.activeLeafMessageId) {
        const activeLeaf = getThreadMessageById(
          existingThread.id,
          updatedThreadAfterLeafSwitch.activeLeafMessageId,
        );
        if (activeLeaf?.role === "user") {
          persistedUserMessageId = activeLeaf.id ?? persistedUserMessageId;
        }
      }
    }
  }

  const moodId = parsed.data.moodId?.trim() ? parsed.data.moodId.trim() : null;

  const task = enqueueChatTask({
    kind: "conversation",
    threadId: thread.id,
    promptMode,
    moodId,
    contextLength: getConfiguredContextLengthForMode(promptMode, process.env),
    userMessage: latestUserMessage.content,
    regenerateOfLastAssistant: isRegenerateRequest,
  });

  if (!isRegenerateRequest) {
    enqueueChatTask({
      kind: "update_intent",
      threadId: thread.id,
      userMessage: latestUserMessage.content,
      contextLength: getConfiguredContextLengthForMode(promptMode, process.env),
    });
  }

  const streamTaskId =
    task.type === "chat"
      ? (task.payload.tasks ?? []).find(
          (groupTask) => groupTask.kind === "chat.stream",
        )?.id ?? task.id
      : task.id;

  void processTaskQueues();

  return Response.json(
    {
      taskId: streamTaskId,
      threadId: thread.id,
      status: task.status,
      userMessageId: persistedUserMessageId,
    },
    { status: 202 },
  );
}








