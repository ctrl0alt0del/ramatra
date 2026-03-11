"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { SkeletonBlock } from "./SkeletonBlock";

type CompletedImage = {
  mimeType: string;
  data: string;
};

type GenerationResponse =
  | { jobId: string; status: "queued" | "running" }
  | { jobId: string; status: "failed"; error?: string }
  | { jobId: string; status: "completed"; images: CompletedImage[] };

export function GeneratedImageCard({
  jobId: _dirtyJobId,
  initialStatus,
}: Readonly<{
  jobId: string;
  initialStatus: "queued" | "running";
}>) {
  let jobId = "";
  try {
    jobId = JSON.parse(_dirtyJobId.replace(/\\/g, "")).jobId;
  } catch {
    jobId = _dirtyJobId;
  }
  const hasValidJobId = jobId.trim().length > 0;
  const [result, setResult] = useState<GenerationResponse>({
    jobId,
    status: initialStatus,
  });

  useEffect(() => {
    if (!hasValidJobId) return;
    if (result.status === "completed" || result.status === "failed") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/comfy/result/${jobId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch generation result");
        }

        const data = (await response.json()) as GenerationResponse;
        if (cancelled) return;

        setResult(data);

        if (data.status === "queued" || data.status === "running") {
          timeoutId = window.setTimeout(poll, 2500);
        }
      } catch {
        if (cancelled) return;
        timeoutId = window.setTimeout(poll, 4000);
      }
    };

    timeoutId = window.setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [hasValidJobId, jobId, result.status]);

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-muted))]">
      {!hasValidJobId && (
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">Generation failed</p>
          <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
            Invalid generation job id.
          </p>
        </div>
      )}

      {hasValidJobId &&
        (result.status === "queued" || result.status === "running") && (
          <div className="space-y-0">
            <div className="relative aspect-square w-full overflow-hidden bg-[hsl(var(--aui-background))]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--aui-border)/0.22),transparent_48%),radial-gradient(circle_at_bottom_right,hsl(var(--aui-border)/0.18),transparent_42%)]" />
              <div className="absolute inset-0 p-4 sm:p-5">
                <div className="grid h-full gap-3">
                  <SkeletonBlock className="h-8 w-28 rounded-full" />
                  <div className="grid flex-1 gap-3 md:grid-cols-[1.2fr_0.8fr]">
                    <SkeletonBlock className="h-full min-h-48 rounded-2xl" />
                    <div className="grid gap-3">
                      <SkeletonBlock className="h-10 w-full" />
                      <SkeletonBlock className="h-10 w-4/5" />
                      <SkeletonBlock className="h-10 w-3/5" />
                      <SkeletonBlock className="h-full min-h-24 rounded-xl" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2 border-t border-[hsl(var(--aui-border))] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Generating image</p>
                <span className="rounded-full border border-[hsl(var(--aui-border))] px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
                  {result.status}
                </span>
              </div>
              <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
                Preparing the ComfyUI job and waiting for the final render.
              </p>
              <p className="truncate text-xs text-[hsl(var(--aui-muted-foreground))]">
                Job <code>{jobId}</code>
              </p>
            </div>
          </div>
        )}

      {hasValidJobId && result.status === "failed" && (
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">Generation failed</p>
          <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
            {result.error ?? "ComfyUI did not return an image."}
          </p>
          <p className="truncate text-xs text-[hsl(var(--aui-muted-foreground))]">
            Job <code>{jobId}</code>
          </p>
        </div>
      )}

      {hasValidJobId && result.status === "completed" && (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Generated image</p>
            <span className="rounded-full border border-[hsl(var(--aui-border))] px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
              done
            </span>
          </div>
          <div className="grid gap-3">
            {result.images.map((image, index) => (
              <Image
                key={`${jobId}-${index}`}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt="Generated result"
                width={1024}
                height={1024}
                unoptimized
                className="aspect-square w-full rounded-xl border border-[hsl(var(--aui-border))] object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
