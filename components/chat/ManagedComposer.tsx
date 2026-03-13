"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

import { useThreadListItemRuntime } from "@assistant-ui/react";
import { Composer } from "@assistant-ui/react-ui";

import { useSystemState } from "./system-state";
import { useThreadEvents } from "./thread-events";

export function ManagedComposer() {
  const threadListItem = useThreadListItemRuntime();
  const { byId } = useThreadEvents();
  const { state: systemState, refresh } = useSystemState();
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const remoteId = threadListItem.getState().remoteId;
  const activeThread = remoteId ? byId[remoteId] : null;
  const contextUsed = activeThread?.contextWindowUsedTokens ?? null;
  const contextTotal = activeThread?.contextWindowTotalTokens ?? null;

  const handleForceResume = async () => {
    try {
      setIsRecovering(true);
      setRecoverError(null);

      const response = await fetch("/api/system/unpause", {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to force resume chat.");
      }

      await refresh();
    } catch (error) {
      setRecoverError(
        error instanceof Error ? error.message : "Failed to force resume chat.",
      );
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-end">
        <ComposerContextIndicator used={contextUsed} total={contextTotal} />
      </div>

      {!systemState.canChat ? (
        <div className="rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(249,241,247,0.94)_100%)] px-4 py-3 text-sm text-[hsl(var(--aui-muted-foreground))] shadow-[0_14px_32px_rgba(73,56,145,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-[hsl(var(--aui-foreground))]">
              Chat paused
            </p>
            <button
              type="button"
              onClick={() => void handleForceResume()}
              disabled={isRecovering}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/70 bg-white/88 px-3 py-1.5 text-xs font-medium text-[hsl(var(--aui-foreground))] shadow-[0_10px_24px_rgba(73,56,145,0.08)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRecovering ? (
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {isRecovering ? "Recovering..." : "Resume Chat"}
            </button>
          </div>
          {systemState.lastError ? (
            <p className="mt-2 text-xs">Last error: {systemState.lastError}</p>
          ) : null}
          {recoverError ? (
            <p className="mt-1 text-xs text-red-500">{recoverError}</p>
          ) : null}
        </div>
      ) : null}

      <Composer.Root className="w-full">
        <Composer.Attachments />
        <Composer.AddAttachment disabled={!systemState.canChat} />
        <Composer.Input autoFocus disabled={!systemState.canChat} />
        {systemState.canChat ? (
          <Composer.Action />
        ) : (
          <button
            type="button"
            disabled
            className="mb-2 mr-2 inline-flex h-9 min-w-24 items-center justify-center rounded-full border border-white/70 bg-white/80 px-3 text-sm text-[hsl(var(--aui-muted-foreground))] opacity-70"
          >
            Paused
          </button>
        )}
      </Composer.Root>
    </div>
  );
}

function ComposerContextIndicator({
  used,
  total,
}: Readonly<{
  used: number | null;
  total: number | null;
}>) {
  const [isOpen, setIsOpen] = useState(false);

  if (used === null || total === null || total <= 0) {
    return null;
  }

  const ratio = Math.min(1, Math.max(0, used / total));
  const percentage = Math.round(ratio * 100);
  const size = 18;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const tone =
    percentage >= 95
      ? "text-[#d66b50]"
      : percentage >= 80
        ? "text-[#d49a41]"
        : "text-[#6e5bff]";

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/75 bg-white/90 shadow-[0_6px_14px_rgba(73,56,145,0.14)]"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens (${percentage}%)`}
        aria-label={`Context usage ${percentage}%`}
        aria-expanded={isOpen}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(105, 89, 180, 0.2)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={`${tone} transition-[stroke-dashoffset,color] duration-300`}
          />
        </svg>
      </button>
      {isOpen ? (
        <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg border border-white/70 bg-white/95 px-2 py-1 text-[11px] font-medium text-[#2d2351] shadow-[0_10px_24px_rgba(73,56,145,0.16)]">
          {used.toLocaleString()} / {total.toLocaleString()} tokens ({percentage}%)
        </div>
      ) : null}
    </div>
  );
}
