"use client";

import { Composer } from "@assistant-ui/react-ui";

import { useSystemState } from "./system-state";

export function ManagedComposer() {
  const systemState = useSystemState();

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
