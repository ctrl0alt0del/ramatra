"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { SkeletonBlock } from "./SkeletonBlock";

type CompletedImage = {
  mimeType: string;
  data: string;
};

type GenerationResponse =
  | {
      taskId: string;
      jobId: string | null;
      status: "queued" | "running";
      progress?: {
        value: number | null;
        max: number | null;
        percentage: number | null;
        node: string | null;
      };
    }
  | {
      taskId: string;
      jobId: string | null;
      status: "failed";
      error?: string;
    }
  | {
      taskId: string;
      jobId: string | null;
      status: "completed";
      images: CompletedImage[];
    };

export function GeneratedImageCard({
  taskId: initialTaskId,
  jobId: initialJobId,
  initialStatus,
}: Readonly<{
  taskId: string | null | undefined;
  jobId: string | null | undefined;
  initialStatus: "queued" | "running";
}>) {
  const taskId = typeof initialTaskId === "string" ? initialTaskId : "";
  const jobId = typeof initialJobId === "string" ? initialJobId : "";

  const hasValidTaskId = taskId.trim().length > 0;
  const [result, setResult] = useState<GenerationResponse>({
    taskId,
    jobId,
    status: initialStatus,
  });
  const [hasResolvedInitialFetch, setHasResolvedInitialFetch] = useState(false);

  useEffect(() => {
    if (!hasValidTaskId) return;

    let cancelled = false;
    let resolvedFirstEvent = false;
    const eventSource = new EventSource(`/api/comfy/task/${taskId}/events`);

    const fallbackFetch = async () => {
      try {
        const response = await fetch(`/api/comfy/task/${taskId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch generation result");
        }

        const data = (await response.json()) as GenerationResponse;
        if (cancelled) return;
        setResult(data);
        setHasResolvedInitialFetch(true);
      } catch (error) {
        if (cancelled) return;
        setResult({
          taskId,
          jobId,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch generation result",
        });
        setHasResolvedInitialFetch(true);
      }
    };

    const onTaskEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as GenerationResponse;
        if (cancelled) return;

        resolvedFirstEvent = true;
        setResult(data);
        setHasResolvedInitialFetch(true);

        if (data.status === "completed" || data.status === "failed") {
          eventSource.close();
        }
      } catch {
        // Ignore malformed events and wait for the next update.
      }
    };

    eventSource.addEventListener("task", onTaskEvent);
    eventSource.onerror = () => {
      eventSource.close();
      if (!resolvedFirstEvent) {
        void fallbackFetch();
      }
    };

    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, [hasValidTaskId, jobId, taskId]);

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-muted))]">
      {!hasValidTaskId && (
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">Generation failed</p>
          <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
            Invalid generation job id.
          </p>
        </div>
      )}

      {hasValidTaskId &&
        (result.status === "queued" || result.status === "running") && (
          <div className="space-y-0">
            <div className="relative aspect-square w-full overflow-hidden bg-[hsl(var(--aui-background))]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--aui-border)/0.22),transparent_48%),radial-gradient(circle_at_bottom_right,hsl(var(--aui-border)/0.18),transparent_42%)]" />
              <div className="absolute inset-0 p-4 sm:p-5">
                <SkeletonBlock className="h-full w-full rounded-[28px]" />
              </div>
            </div>
            <div className="h-1.5 w-full bg-[hsl(var(--aui-border))/0.45]">
              <div
                className="h-full bg-[linear-gradient(90deg,#7f74ff_0%,#b7adff_100%)] transition-[width] duration-500 ease-out"
                style={{
                  width:
                    hasResolvedInitialFetch &&
                    result.progress?.percentage !== null &&
                    result.progress?.percentage !== undefined
                      ? `${result.progress.percentage}%`
                      : "8%",
                }}
              />
            </div>
            <div className="border-t border-[hsl(var(--aui-border))] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {hasResolvedInitialFetch ? "Generating image" : "Loading image"}
                </p>
                <span className="rounded-full border border-[hsl(var(--aui-border))] px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
                  {hasResolvedInitialFetch
                    ? result.progress?.percentage !== null &&
                      result.progress?.percentage !== undefined
                      ? `${result.progress.percentage}%`
                      : result.status
                    : "loading"}
                </span>
              </div>
            </div>
          </div>
        )}

      {hasValidTaskId && result.status === "failed" && (
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">Generation failed</p>
          <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
            {result.error ?? "ComfyUI did not return an image."}
          </p>
        </div>
      )}

      {hasValidTaskId && result.status === "completed" && (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Generated image</p>
            <span className="rounded-full border border-[hsl(var(--aui-border))] px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
              done
            </span>
          </div>
          <div className="grid gap-3">
            {result.images.map((image, index) => (
              <Dialog.Root key={`${taskId}-${index}`}>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="overflow-hidden rounded-xl border border-[hsl(var(--aui-border))] text-left transition-opacity hover:opacity-95"
                  >
                    <Image
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt="Generated result"
                      width={1024}
                      height={1024}
                      unoptimized
                      className="h-auto w-full object-contain"
                    />
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
                  <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(92vw,1400px)] -translate-x-1/2 -translate-y-1/2 outline-none">
                    <Image
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt="Generated result enlarged"
                      width={1600}
                      height={1600}
                      unoptimized
                      className="max-h-[92vh] h-auto w-full rounded-2xl object-contain"
                    />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
