"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Info, MessageSquareText } from "lucide-react";
import { useThread, useThreadRuntime } from "@assistant-ui/react";
import { createCritiqueRequestMarker } from "@/lib/chat/critique-marker";

import { SkeletonBlock } from "./SkeletonBlock";
import { useMood } from "./mood";
import type { ThreadApiDetail } from "./types";

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

type CritiqueStartResponse = {
  taskId: string;
  critiqueTaskId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

type ChatTaskEvent =
  | {
      taskId: string;
      status: "queued" | "running" | "completed";
      text: string;
      reasoning: string;
      responseId: string | null;
      summaryCallsInCurrentRequest: number;
      delegatedToTaskGroupId?: string;
    }
  | {
      taskId: string;
      status: "failed";
      error: string;
    };

type CritiqueState = {
  status: "idle" | "queued" | "running" | "completed" | "failed";
  taskId?: string;
  error?: string;
};

type RuntimeMessage = {
  role: "assistant" | "user" | "system";
  content: Array<
    { type: "text"; text: string } | { type: "reasoning"; text: string }
  >;
};

function GenerateParamsTooltip({
  params,
}: Readonly<{ params: Record<string, unknown> | null }>) {
  const [open, setOpen] = useState(false);
  if (!params) {
    return null;
  }

  const json = JSON.stringify(params, null, 2);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] text-[hsl(var(--aui-muted-foreground))] transition hover:text-[hsl(var(--aui-foreground))]"
        aria-label="Show generate image parameters"
        title="Show generate image parameters"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-9 z-20 w-[min(90vw,560px)] rounded-xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-[hsl(var(--aui-foreground))]">
            `generate_image` parameters
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[hsl(var(--aui-muted))] p-2 text-[11px] leading-5 text-[hsl(var(--aui-muted-foreground))]">
            {json}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

const mapThreadToRuntimeMessages = (thread: ThreadApiDetail): RuntimeMessage[] =>
  thread.messages.map((message) => ({
    role: message.role,
    content: message.content
      .filter((part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
      )
      .map((part) => ({ type: "text" as const, text: part.text })),
  }));

export function GeneratedImageCard({
  taskId: initialTaskId,
  jobId: initialJobId,
  initialStatus,
  threadId,
  markerParams,
}: Readonly<{
  taskId: string | null | undefined;
  jobId: string | null | undefined;
  initialStatus: "queued" | "running";
  threadId: string | null;
  markerParams: Record<string, unknown> | null;
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
  const [critiques, setCritiques] = useState<Record<number, CritiqueState>>({});
  const critiqueStreamsRef = useRef<Record<number, EventSource>>({});
  const followupStreamsRef = useRef<Record<number, EventSource>>({});
  const followupStreamIdsRef = useRef<Record<number, string>>({});
  const threadRuntime = useThreadRuntime({ optional: true });
  const isThreadRunning = useThread((state) => state.isRunning);
  const { moodId } = useMood();

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

  useEffect(() => {
    return () => {
      for (const stream of Object.values(critiqueStreamsRef.current)) {
        stream.close();
      }
      for (const stream of Object.values(followupStreamsRef.current)) {
        stream.close();
      }
      critiqueStreamsRef.current = {};
      followupStreamsRef.current = {};
      followupStreamIdsRef.current = {};
    };
  }, []);  useEffect(() => {
    if (isThreadRunning) {
      return;
    }

    setCritiques((previous) => {
      let changed = false;
      const next: Record<number, CritiqueState> = {};

      for (const [key, value] of Object.entries(previous)) {
        if (value.status === "queued" || value.status === "running") {
          changed = true;
          next[Number(key)] = {
            ...value,
            status: "completed",
          };
        } else {
          next[Number(key)] = value;
        }
      }

      return changed ? next : previous;
    });
  }, [isThreadRunning]);

  const loadThreadRuntimeMessages = async () => {
    if (!threadId) {
      return null;
    }

    const response = await fetch(`/api/threads/${threadId}`);
    if (!response.ok) {
      throw new Error("Failed to refresh thread.");
    }

    const data = (await response.json()) as { thread: ThreadApiDetail };
    return mapThreadToRuntimeMessages(data.thread);
  };

  const connectCritiqueStream = (imageIndex: number, critiqueTaskId: string) => {
    critiqueStreamsRef.current[imageIndex]?.close();

    const source = new EventSource(`/api/chat/task/${critiqueTaskId}/events`);
    critiqueStreamsRef.current[imageIndex] = source;
    let baseRuntimeMessages: any[] | null = null;

    if (threadRuntime) {
      baseRuntimeMessages = threadRuntime
        .getState()
        .messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));

      threadRuntime.reset([
        ...(baseRuntimeMessages as any),
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Generating critique..." }],
        },
      ]);
    }

    const ensureBaseRuntimeMessages = () => {
      if (baseRuntimeMessages) {
        return baseRuntimeMessages;
      }
      if (threadRuntime) {
        baseRuntimeMessages = threadRuntime
          .getState()
          .messages.map((message) => ({
            role: message.role,
            content: message.content,
          }));
      } else {
        baseRuntimeMessages = [];
      }
      return baseRuntimeMessages;
    };

    const mirrorLiveCritiqueIntoChat = async (
      payload: Extract<ChatTaskEvent, { status: "queued" | "running" | "completed" }>,
    ) => {
      if (!threadRuntime) {
        return;
      }

      const baseMessages = ensureBaseRuntimeMessages();

      const liveText = payload.text.trim();
      const liveReasoning = payload.reasoning.trim();
      const fallbackText =
        payload.status === "completed" ? "" : "Generating critique...";
      const nextText = liveText || fallbackText;
      const nextContent: RuntimeMessage["content"] = [];

      if (liveReasoning) {
        nextContent.push({ type: "reasoning", text: liveReasoning });
      }
      if (nextText) {
        nextContent.push({ type: "text", text: nextText });
      }

      if (nextContent.length === 0) {
        threadRuntime.reset(baseMessages);
        return;
      }

      threadRuntime.reset([
        ...(baseMessages as any),
        {
          role: "assistant" as const,
          content: nextContent,
        },
      ]);
    };

    source.addEventListener("task", (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ChatTaskEvent;

      if (payload.status === "failed") {
        setCritiques((previous) => ({
          ...previous,
          [imageIndex]: {
            status: "failed",
            taskId: critiqueTaskId,
            error: payload.error || "Critique failed.",
          },
        }));
        source.close();
        delete critiqueStreamsRef.current[imageIndex];
        return;
      }

      setCritiques((previous) => ({
        ...previous,
        [imageIndex]: {
          ...previous[imageIndex],
          status:
            payload.status === "completed"
              ? "completed"
              : payload.status === "running"
                ? "running"
                : "queued",
          taskId: critiqueTaskId,
        },
      }));

      if (payload.status === "completed") {
        const delegatedTaskId =
          typeof payload.delegatedToTaskGroupId === "string" &&
          payload.delegatedToTaskGroupId.trim().length > 0
            ? payload.delegatedToTaskGroupId
            : null;

        if (
          delegatedTaskId &&
          followupStreamIdsRef.current[imageIndex] !== delegatedTaskId
        ) {
          followupStreamIdsRef.current[imageIndex] = delegatedTaskId;
          const followupSource = new EventSource(
            `/api/chat/task/${delegatedTaskId}/events`,
          );
          followupStreamsRef.current[imageIndex] = followupSource;

          followupSource.addEventListener(
            "task",
            (followupEvent: MessageEvent<string>) => {
              const followupPayload = JSON.parse(
                followupEvent.data,
              ) as ChatTaskEvent;

              if (followupPayload.status === "failed") {
                setCritiques((previous) => ({
                  ...previous,
                  [imageIndex]: {
                    ...previous[imageIndex],
                    status: "failed",
                    taskId: critiqueTaskId,
                    error: followupPayload.error || "Critique follow-up failed.",
                  },
                }));
                followupSource.close();
                delete followupStreamsRef.current[imageIndex];
                return;
              }

              void mirrorLiveCritiqueIntoChat(followupPayload);

              if (followupPayload.status !== "completed") {
                return;
              }

              void (async () => {
                if (!threadRuntime) {
                  return;
                }

                try {
                  const runtimeMessages = await loadThreadRuntimeMessages();
                  if (!runtimeMessages) {
                    return;
                  }
                  threadRuntime.reset(runtimeMessages);
                } catch {
                  // Ignore refresh failures; persisted history still contains the message.
                }
              })();

              followupSource.close();
              delete followupStreamsRef.current[imageIndex];
            },
          );

          followupSource.onerror = () => {
            followupSource.close();
            delete followupStreamsRef.current[imageIndex];
          };
        }

        source.close();
        delete critiqueStreamsRef.current[imageIndex];
      }
    });

    source.onerror = () => {
      setCritiques((previous) => ({
        ...previous,
        [imageIndex]: {
          ...previous[imageIndex],
          status: "failed",
          taskId: critiqueTaskId,
          error: "Critique stream connection failed.",
        },
      }));
      source.close();
      delete critiqueStreamsRef.current[imageIndex];
    };
  };

  const runCritique = async (imageIndex: number) => {
    setCritiques((previous) => ({
      ...previous,
      [imageIndex]: {
        status: "running",
      },
    }));

    try {
      if (!threadRuntime) {
        throw new Error("Thread runtime is unavailable.");
      }

      const marker = createCritiqueRequestMarker({
        comfyTaskId: taskId,
        imageIndex,
      });

      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: marker }],
      });

      setCritiques((previous) => ({
        ...previous,
        [imageIndex]: {
          ...previous[imageIndex],
          status: "queued",
          error: undefined,
        },
      }));
    } catch (error) {
      setCritiques((previous) => ({
        ...previous,
        [imageIndex]: {
          ...previous[imageIndex],
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate critique.",
        },
      }));
    }
  };

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
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {hasResolvedInitialFetch ? "Generating image" : "Loading image"}
                  </p>
                  <GenerateParamsTooltip params={markerParams} />
                </div>
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
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Generated image</p>
              <GenerateParamsTooltip params={markerParams} />
            </div>
            <span className="rounded-full border border-[hsl(var(--aui-border))] px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
              done
            </span>
          </div>
          <div className="grid gap-3">
            {result.images.map((image, index) => {
              const critiqueState = critiques[index];
              const isCritiquing =
                critiqueState?.status === "queued" ||
                critiqueState?.status === "running";

              return (
                <div
                  key={`${taskId}-${index}`}
                  className="space-y-2 overflow-hidden rounded-xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))]"
                >
                  <div className="relative">
                    <Dialog.Root>
                      <Dialog.Trigger asChild>
                        <button
                          type="button"
                          className="w-full overflow-hidden text-left transition-opacity hover:opacity-95"
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

                    <button
                      type="button"
                      onClick={() => void runCritique(index)}
                      disabled={isCritiquing}
                      className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--aui-border))] bg-white/90 px-3 py-1.5 text-xs font-medium text-[hsl(var(--aui-foreground))] shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      {isCritiquing ? "Critiquing..." : "Critique"}
                    </button>
                  </div>

                  {critiqueState?.status === "failed" ? (
                    <div className="px-3 pb-3">
                      <p className="rounded-lg border border-[#ffd8cd] bg-[#fff7f3] px-3 py-2 text-xs text-[#7a4a3d]">
                        {critiqueState.error ?? "Critique failed."}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}











