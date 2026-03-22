type MessageReasoningKeyInput = {
  messageId?: string | null;
  dbMessageId?: string | null;
};

type ReasoningListener = (reasoning: string) => void;

const reasoningByKey = new Map<string, string>();
const listenersByKey = new Map<string, Set<ReasoningListener>>();

const normalizeKey = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getKeys = (input: MessageReasoningKeyInput) => {
  const keys = new Set<string>();
  const messageId = normalizeKey(input.messageId);
  const dbMessageId = normalizeKey(input.dbMessageId);

  if (messageId) {
    keys.add(messageId);
  }
  if (dbMessageId) {
    keys.add(dbMessageId);
  }

  return [...keys];
};

const publish = (key: string, reasoning: string) => {
  const listeners = listenersByKey.get(key);
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(reasoning);
  }
};

export const getMessageReasoning = (input: MessageReasoningKeyInput) => {
  const keys = getKeys(input);
  for (const key of keys) {
    const value = reasoningByKey.get(key);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return "";
};

export const setMessageReasoning = (
  input: MessageReasoningKeyInput,
  reasoning: string,
) => {
  const keys = getKeys(input);
  if (keys.length === 0) {
    return;
  }

  const normalizedReasoning = reasoning.trim();
  for (const key of keys) {
    const previous = reasoningByKey.get(key) ?? "";
    if (previous === normalizedReasoning) {
      continue;
    }

    reasoningByKey.set(key, normalizedReasoning);
    publish(key, normalizedReasoning);
  }
};

export const subscribeToMessageReasoning = (
  input: MessageReasoningKeyInput,
  listener: ReasoningListener,
) => {
  const keys = getKeys(input);
  if (keys.length === 0) {
    return () => {};
  }

  for (const key of keys) {
    const listeners = listenersByKey.get(key) ?? new Set<ReasoningListener>();
    listeners.add(listener);
    listenersByKey.set(key, listeners);
  }

  return () => {
    for (const key of keys) {
      const listeners = listenersByKey.get(key);
      if (!listeners) {
        continue;
      }

      listeners.delete(listener);
      if (listeners.size === 0) {
        listenersByKey.delete(key);
      }
    }
  };
};
