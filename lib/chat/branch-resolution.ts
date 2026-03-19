import { extractComfyJobMarker } from "@/components/chat/comfy-marker";
import { serializeMessageContent, type MessagePart } from "@/lib/chat/message-content";

type BranchRole = "system" | "user" | "assistant";

type BranchMessage = {
  id?: string;
  messageUiId?: string | null;
  parentMessageId?: string | null;
  role: BranchRole;
  content: MessagePart[];
};

type BranchThreadSnapshot = {
  activeLeafMessageId: string | null;
  messages: BranchMessage[];
};

type PayloadMessage = {
  role: BranchRole;
  content: MessagePart[];
  messageUiId?: string | null;
};

export const resolveMessageIdFromThread = (
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

const findParentByPayloadChain = (
  fullThreadMessages: BranchMessage[],
  payloadMessages: PayloadMessage[],
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

export const resolveConversationParentMessageId = ({
  fullThread,
  inputMessages,
  selectedParentMessageId,
  selectedEditingMessageId,
  hasExplicitParentSelection,
}: {
  fullThread: BranchThreadSnapshot | null;
  inputMessages: PayloadMessage[];
  selectedParentMessageId: string | null;
  selectedEditingMessageId: string | null;
  hasExplicitParentSelection: boolean;
}) => {
  const selectedParentMessageIdIfExists = resolveMessageIdFromThread(
    fullThread,
    selectedParentMessageId,
  );
  const selectedEditingMessageIdIfExists = resolveMessageIdFromThread(
    fullThread,
    selectedEditingMessageId,
  );

  const parentEqualsEditingMessage =
    selectedParentMessageIdIfExists !== null &&
    selectedEditingMessageIdIfExists !== null &&
    selectedParentMessageIdIfExists === selectedEditingMessageIdIfExists;

  const normalizedSelectedParentMessageId = parentEqualsEditingMessage
    ? null
    : selectedParentMessageIdIfExists;

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

  const hasExplicitEditingTarget = selectedEditingMessageId !== null;

  if (hasExplicitParentSelection) {
    return normalizedSelectedParentMessageId;
  }

  if (hasExplicitEditingTarget) {
    return inferredParentFromEditingMessageId;
  }

  return normalizedSelectedParentMessageId ?? inferredParentMessageId ?? null;
};

const inferCritiqueParentFromMarker = ({
  fullThread,
  comfyTaskId,
  jobId,
}: {
  fullThread: BranchThreadSnapshot | null;
  comfyTaskId: string;
  jobId: string | null;
}) => {
  if (!fullThread) {
    return null;
  }

  for (let index = fullThread.messages.length - 1; index >= 0; index -= 1) {
    const message = fullThread.messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    if (!text.trim()) {
      continue;
    }

    const { marker } = extractComfyJobMarker(text);
    if (!marker) {
      continue;
    }

    const markerMatchesTask = marker.taskId === comfyTaskId;
    const markerMatchesJob =
      typeof jobId === "string" &&
      jobId.length > 0 &&
      typeof marker.jobId === "string" &&
      marker.jobId.length > 0 &&
      marker.jobId === jobId;

    if (markerMatchesTask || markerMatchesJob) {
      return message.id ?? null;
    }
  }

  return null;
};

export const resolveCritiqueParentMessageId = ({
  fullThread,
  requestedParentMessageId,
  hasExplicitParentSelection,
  comfyTaskId,
  jobId,
}: {
  fullThread: BranchThreadSnapshot | null;
  requestedParentMessageId: string | null;
  hasExplicitParentSelection: boolean;
  comfyTaskId: string;
  jobId: string | null;
}) => {
  const normalizedRequestedParentId = resolveMessageIdFromThread(
    fullThread,
    requestedParentMessageId,
  );

  if (hasExplicitParentSelection) {
    return normalizedRequestedParentId;
  }

  const inferredMarkerParentId = inferCritiqueParentFromMarker({
    fullThread,
    comfyTaskId,
    jobId,
  });

  return inferredMarkerParentId ?? fullThread?.activeLeafMessageId ?? null;
};
