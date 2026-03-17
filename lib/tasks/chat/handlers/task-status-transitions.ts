const setStatuses = <K extends string, S extends "pending" | "completed" | "failed">({
  taskId,
  status,
  kinds,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  status: S;
  kinds: K[];
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: K;
    status: S;
  }) => void;
}) => {
  for (const kind of kinds) {
    setGroupTaskStatusByKind({ taskId, kind, status });
  }
};

export const setConversationGenerateAndStreamPending = ({
  taskId,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.generate" | "chat.stream";
    status: "pending";
  }) => void;
}) =>
  setStatuses({
    taskId,
    status: "pending",
    kinds: ["chat.generate", "chat.stream"],
    setGroupTaskStatusByKind,
  });

export const setConversationGenerateAndStreamFailed = ({
  taskId,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.generate" | "chat.stream";
    status: "failed";
  }) => void;
}) =>
  setStatuses({
    taskId,
    status: "failed",
    kinds: ["chat.generate", "chat.stream"],
    setGroupTaskStatusByKind,
  });

export const setCritiqueFromUnbiasedFailed = ({
  taskId,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.unbiased_critique" | "chat.biased_critique" | "chat.stream";
    status: "failed";
  }) => void;
}) =>
  setStatuses({
    taskId,
    status: "failed",
    kinds: ["chat.unbiased_critique", "chat.biased_critique", "chat.stream"],
    setGroupTaskStatusByKind,
  });

export const setCritiqueFromBiasedFailed = ({
  taskId,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.biased_critique" | "chat.stream";
    status: "failed";
  }) => void;
}) =>
  setStatuses({
    taskId,
    status: "failed",
    kinds: ["chat.biased_critique", "chat.stream"],
    setGroupTaskStatusByKind,
  });
