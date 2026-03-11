"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

import { Composer } from "@assistant-ui/react-ui";

import { useSystemState } from "./system-state";

export function ManagedComposer() {
  const { state: systemState, refresh } = useSystemState();
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

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
      {!systemState.canChat ? (
        <div className="rounded-2xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-muted))] px-4 py-3 text-sm text-[hsl(var(--aui-muted-foreground))]">
          <p className="font-medium text-[hsl(var(--aui-foreground))]">
            Chat paused
          </p>
          <p>{systemState.message}</p>
          {systemState.lastError ? (
            <p className="mt-1 text-xs">Last error: {systemState.lastError}</p>
          ) : null}
          {recoverError ? (
            <p className="mt-1 text-xs text-red-500">{recoverError}</p>
          ) : null}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void handleForceResume()}
              disabled={isRecovering}
              className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] px-4 py-2 text-sm font-medium text-[hsl(var(--aui-foreground))] shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRecovering ? (
                <Sparkles className="h-4 w-4 animate-pulse" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {isRecovering ? "Recovering chat..." : "Force Resume Chat"}
            </button>
          </div>
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
            className="mb-2 mr-2 inline-flex h-8 min-w-20 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] px-3 text-sm text-[hsl(var(--aui-muted-foreground))] opacity-70"
          >
            Paused
          </button>
        )}
      </Composer.Root>
    </div>
  );
}
