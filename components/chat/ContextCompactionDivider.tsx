"use client";

import { useEffect, useMemo, useState } from "react";

import { useThread, useThreadListItemRuntime } from "@assistant-ui/react";

import { useThreadEvents } from "./thread-events";
import { ContextCompactionInline } from "./ContextCompactionInline";

const NOTICE_VISIBLE_MS = 8_000;

export function ContextCompactionDivider() {
  const threadListItem = useThreadListItemRuntime();
  const { byId, compactionById } = useThreadEvents();
  const isThreadRunning = useThread((state) => state.isRunning);
  const [now, setNow] = useState(Date.now());

  const remoteId = threadListItem?.getState().remoteId ?? null;
  const activeThread = remoteId ? byId[remoteId] : null;
  const compactionNotice = remoteId ? compactionById[remoteId] : undefined;

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const viewState = useMemo(() => {
    const hasInRequestCompaction =
      Boolean(activeThread?.summaryCallsInCurrentRequest) && isThreadRunning;
    const isRecentCompaction =
      Boolean(compactionNotice) &&
      now - (compactionNotice?.at ?? 0) <= NOTICE_VISIBLE_MS;

    if (hasInRequestCompaction) {
      return {
        visible: true,
        text: `Context compacted during response (${activeThread?.summaryCallsInCurrentRequest ?? 0})`,
      };
    }

    if (isRecentCompaction) {
      return {
        visible: true,
        text: "Context compacted between messages",
      };
    }

    return {
      visible: false,
      text: "",
    };
  }, [activeThread?.summaryCallsInCurrentRequest, compactionNotice, isThreadRunning, now]);

  if (!viewState.visible) {
    return null;
  }

  return (
    <ContextCompactionInline text={viewState.text} />
  );
}
