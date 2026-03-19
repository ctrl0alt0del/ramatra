import { configureStore, createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ThreadRuntimeSnapshot = {
  messages: unknown[];
  messageRepository: unknown | null;
  transientReasoningByKey: Record<string, string>;
  localToDbMessageId: Record<string, string>;
};

type ChatRuntimeState = {
  byThread: Record<string, ThreadRuntimeSnapshot>;
};

const initialState: ChatRuntimeState = {
  byThread: {},
};

const ensureThreadSnapshot = (state: ChatRuntimeState, threadId: string) => {
  return (state.byThread[threadId] ??= {
    messages: [],
    messageRepository: null,
    transientReasoningByKey: {},
    localToDbMessageId: {},
  });
};

const chatRuntimeSlice = createSlice({
  name: "chatRuntime",
  initialState,
  reducers: {
    setThreadSnapshot: (
      state,
      action: PayloadAction<{
        threadId: string;
        messages: unknown[];
        messageRepository: unknown;
      }>,
    ) => {
      const { threadId, messages, messageRepository } = action.payload;
      if (!threadId) {
        return;
      }

      const snapshot = ensureThreadSnapshot(state, threadId);
      snapshot.messages = messages;
      snapshot.messageRepository = messageRepository;
    },
    setThreadLocalToDbMap: (
      state,
      action: PayloadAction<{ threadId: string; map: Record<string, string> }>,
    ) => {
      const { threadId, map } = action.payload;
      if (!threadId) {
        return;
      }

      const snapshot = ensureThreadSnapshot(state, threadId);
      snapshot.localToDbMessageId = { ...map };
    },
    setLocalToDbMapping: (
      state,
      action: PayloadAction<{ threadId: string; localId: string; dbId: string }>,
    ) => {
      const { threadId, localId, dbId } = action.payload;
      if (!threadId || !localId || !dbId) {
        return;
      }

      const snapshot = ensureThreadSnapshot(state, threadId);
      snapshot.localToDbMessageId[localId] = dbId;
    },
    setReasoning: (
      state,
      action: PayloadAction<{ threadId: string; key: string; reasoning: string }>,
    ) => {
      const { threadId, key, reasoning } = action.payload;
      if (!threadId || !key) {
        return;
      }

      const snapshot = ensureThreadSnapshot(state, threadId);
      const normalized = reasoning.trim();
      if (!normalized) {
        delete snapshot.transientReasoningByKey[key];
      } else {
        snapshot.transientReasoningByKey[key] = normalized;
      }
    },
    clearThread: (state, action: PayloadAction<{ threadId: string }>) => {
      const { threadId } = action.payload;
      if (!threadId) {
        return;
      }

      delete state.byThread[threadId];
    },
  },
});

export const chatRuntimeStore = configureStore({
  reducer: {
    chatRuntime: chatRuntimeSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false,
    }),
});

const {
  setThreadSnapshot: setThreadSnapshotAction,
  setThreadLocalToDbMap: setThreadLocalToDbMapAction,
  setLocalToDbMapping: setLocalToDbMappingAction,
  setReasoning,
  clearThread,
} = chatRuntimeSlice.actions;

export const setThreadSnapshot = (
  threadId: string,
  messages: unknown[],
  messageRepository: unknown,
) => {
  chatRuntimeStore.dispatch(
    setThreadSnapshotAction({
      threadId,
      messages,
      messageRepository,
    }),
  );
};

export const getThreadSnapshot = (threadId: string) => {
  return chatRuntimeStore.getState().chatRuntime.byThread[threadId] ?? null;
};

export const setThreadLocalToDbMap = (
  threadId: string,
  map: Record<string, string>,
) => {
  chatRuntimeStore.dispatch(setThreadLocalToDbMapAction({ threadId, map }));
};

export const setLocalToDbMessageId = (
  threadId: string,
  localId: string,
  dbId: string,
) => {
  chatRuntimeStore.dispatch(
    setLocalToDbMappingAction({
      threadId,
      localId,
      dbId,
    }),
  );
};

export const getLocalToDbMap = (threadId: string) => {
  const snapshot = chatRuntimeStore.getState().chatRuntime.byThread[threadId];
  return snapshot?.localToDbMessageId ?? {};
};

export const setTransientReasoning = (
  threadId: string,
  key: string,
  reasoning: string,
) => {
  chatRuntimeStore.dispatch(setReasoning({ threadId, key, reasoning }));
};

export const getTransientReasoning = (threadId: string, key: string) => {
  const snapshot = chatRuntimeStore.getState().chatRuntime.byThread[threadId];
  return snapshot?.transientReasoningByKey[key] ?? null;
};

export const clearThreadRuntimeState = (threadId: string) => {
  chatRuntimeStore.dispatch(clearThread({ threadId }));
};
