import type { TaskGroupPayloadMap } from "@/lib/tasks/types";

type ConversationPayload = Extract<TaskGroupPayloadMap["chat"], { kind: "conversation" }>;

export const resolveConversationPreviousResponseId = ({
  payload,
  threadResponseId,
}: {
  payload: ConversationPayload;
  threadResponseId: string | null;
}) => {
  const isUtilConversation =
    typeof payload.utilTaskName === "string" &&
    payload.utilTaskName.trim().length > 0;
  const hasExplicitPreviousResponseIdOverride = Object.prototype.hasOwnProperty.call(
    payload,
    "previousResponseIdOverride",
  );
  const normalizedPreviousResponseIdOverride =
    typeof payload.previousResponseIdOverride === "string" &&
    payload.previousResponseIdOverride.trim().length > 0
      ? payload.previousResponseIdOverride.trim()
      : null;

  if (isUtilConversation) {
    return null;
  }

  if (hasExplicitPreviousResponseIdOverride) {
    return normalizedPreviousResponseIdOverride;
  }

  if ((payload.continuationIndex ?? 0) > 0) {
    return null;
  }

  return threadResponseId;
};
