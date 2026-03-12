"use client";

import { Archive, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

import { useThreadRuntime } from "@assistant-ui/react";
import { Composer } from "@assistant-ui/react-ui";

import { usePromptMode } from "./prompt-mode";
import { resolvePersistedThreadId } from "./runtime";
import { useSystemState } from "./system-state";

export function ManagedComposer() {
  const threadRuntime = useThreadRuntime();
  const { mode } = usePromptMode();
  const { state: systemState, refresh } = useSystemState();
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [isCollapsingContext, setIsCollapsingContext] = useState(false);
  const [collapseError, setCollapseError] = useState<string | null>(null);

  const handleCollapseContext = async () => {
    try {
      setIsCollapsingContext(true);
      setCollapseError(null);

      const remoteId = resolvePersistedThreadId(threadRuntime.getState().remoteId);
      if (!remoteId) {
        throw new Error("No thread selected.");
      }

      const response = await fetch(`/api/threads/${remoteId}/collapse-context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ promptMode: mode }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Failed to collapse context.");
      }
    } catch (error) {
      setCollapseError(
        error instanceof Error ? error.message : "Failed to collapse context.",
      );
    } finally {
      setIsCollapsingContext(false);
    }
  };

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
        <button
          type="button"
          onClick={() => void handleCollapseContext()}
          disabled={isCollapsingContext}
          className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/84 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--aui-muted-foreground))] shadow-[0_10px_24px_rgba(73,56,145,0.08)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Archive className="h-3.5 w-3.5" />
          {isCollapsingContext ? "Collapsing context..." : "Collapse Context"}
        </button>
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
          {collapseError ? (
            <p className="mt-1 text-xs text-red-500">{collapseError}</p>
          ) : null}
        </div>
      ) : null}
      {systemState.canChat && collapseError ? (
        <p className="text-xs text-red-500">{collapseError}</p>
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
