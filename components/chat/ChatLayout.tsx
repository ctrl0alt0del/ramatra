"use client";

import { useEffect, useState } from "react";

import * as Dialog from "@radix-ui/react-dialog";
import { Thread, ThreadList } from "@assistant-ui/react-ui";
import {
  ChartNoAxesCombined,
  CircleAlert,
  Gauge,
  HardDrive,
  HeartPulse,
  PanelLeft,
  Sparkles,
  X,
} from "lucide-react";

import { CustomAssistantMessage } from "./CustomAssistantMessage";
import { CustomThreadListItem } from "./CustomThreadListItem";
import { CustomUserMessage } from "./CustomUserMessage";
import { ManagedComposer } from "./ManagedComposer";
import { PromptModeSelect } from "./prompt-mode";
import { SystemStateProvider, useSystemState } from "./system-state";

type MonitorState = {
  checkedAt: string;
  services: {
    lmStudio: {
      ok: boolean;
      detail: string;
    };
    comfy: {
      ok: boolean;
      detail: string;
    };
  };
  gpu: {
    name: string;
    utilization: number | null;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
    temperatureC: number | null;
  } | null;
  queue: {
    phase: "chat_ready" | "switching_to_image" | "image_running" | "restoring_chat";
    canChat: boolean;
    activeGenerationCount: number;
    message: string;
    lastError: string | null;
  };
};

export function ChatLayout() {
  return (
    <SystemStateProvider>
      <ChatWorkspace />
    </SystemStateProvider>
  );
}

function ChatWorkspace() {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { state: systemState } = useSystemState();
  const monitor = useSystemMonitor();

  const monitorCards = [
    {
      icon: Gauge,
      label: "GPU Load",
      value:
        monitor.data?.gpu?.utilization !== null &&
        monitor.data?.gpu?.utilization !== undefined
          ? `${monitor.data.gpu.utilization}%`
          : "Unavailable",
      detail: formatGpuTemperature(monitor.data?.gpu?.temperatureC ?? null),
      tone:
        (monitor.data?.gpu?.utilization ?? 0) > 90 ? "warn" : "neutral",
    },
    {
      icon: HardDrive,
      label: "VRAM",
      value: formatVramUsage(
        monitor.data?.gpu?.memoryUsedMb ?? null,
        monitor.data?.gpu?.memoryTotalMb ?? null,
      ),
      detail: monitor.data?.gpu?.name ?? "GPU details unavailable",
      tone:
        getVramUsageRatio(
          monitor.data?.gpu?.memoryUsedMb ?? null,
          monitor.data?.gpu?.memoryTotalMb ?? null,
        ) > 0.9
          ? "warn"
          : "neutral",
    },
    {
      icon: HeartPulse,
      label: "LM Studio",
      value: monitor.data?.services.lmStudio.ok ? "Healthy" : "Offline",
      detail:
        monitor.data?.services.lmStudio.detail ?? "Checking LM Studio...",
      tone: monitor.data?.services.lmStudio.ok ? "good" : "warn",
    },
    {
      icon: ChartNoAxesCombined,
      label: "ComfyUI",
      value: monitor.data?.services.comfy.ok ? "Healthy" : "Offline",
      detail: monitor.data?.services.comfy.detail ?? "Checking ComfyUI...",
      tone:
        monitor.data?.queue.activeGenerationCount
          ? "active"
          : monitor.data?.services.comfy.ok
            ? "good"
            : "warn",
    },
  ] as const;

  return (
    <div className="aui-root relative flex h-[100dvh] w-full overflow-hidden sm:px-4 sm:py-4 md:px-6 md:py-6">
      <div className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden bg-white/75 shadow-[0_28px_80px_rgba(73,56,145,0.22)] backdrop-blur-2xl sm:rounded-[28px] sm:border sm:border-white/60 md:rounded-[34px]">
        <aside
          className={`hidden min-h-0 shrink-0 border-r border-[hsl(var(--aui-border))]/70 bg-white/45 transition-[width] duration-300 md:flex md:flex-col ${
            desktopSidebarOpen ? "md:w-[22rem] lg:w-[24rem]" : "md:w-[5.25rem]"
          }`}
        >
          {desktopSidebarOpen ? (
            <SidebarPanel onCollapse={() => setDesktopSidebarOpen(false)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-between px-3 py-4">
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] text-sm font-semibold text-white shadow-[0_14px_32px_rgba(98,87,210,0.35)]">
                  CB
                </div>
                <button
                  type="button"
                  onClick={() => setDesktopSidebarOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/65 bg-white/80 text-[hsl(var(--aui-foreground))] shadow-[0_12px_26px_rgba(73,56,145,0.12)] transition hover:bg-white"
                  aria-label="Expand sidebar"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="rounded-full border border-white/65 bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[hsl(var(--aui-muted-foreground))]">
                AI
              </div>
            </div>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[hsl(var(--aui-border))]/70 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <Dialog.Root
                  open={mobileSidebarOpen}
                  onOpenChange={setMobileSidebarOpen}
                >
                  <Dialog.Trigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/65 bg-white/80 text-[hsl(var(--aui-foreground))] shadow-[0_10px_24px_rgba(73,56,145,0.12)] transition hover:bg-white md:hidden"
                      aria-label="Open threads"
                    >
                      <PanelLeft className="h-4 w-4" />
                    </button>
                  </Dialog.Trigger>

                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-40 bg-[#1d1738]/30 backdrop-blur-md md:hidden" />
                    <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(23rem,92vw)] outline-none md:hidden">
                      <SidebarPanel
                        isMobile
                        onCollapse={() => setMobileSidebarOpen(false)}
                      />
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>

                <div className="min-w-0">
                  <div className="hidden items-center gap-2 rounded-full border border-white/65 bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))] shadow-[0_8px_20px_rgba(73,56,145,0.08)] sm:inline-flex">
                    <Sparkles className="h-3.5 w-3.5 text-[#7e71ff]" />
                    Local AI Workspace
                  </div>
                  <h1 className="text-[1.35rem] font-extrabold tracking-[-0.04em] text-[#1f1838] sm:mt-3 sm:text-[2.2rem]">
                    Comfy Bridge
                  </h1>
                  <p className="mt-1 text-sm text-[hsl(var(--aui-muted-foreground))] sm:mt-2">
                    Chat and image prompting.
                  </p>
                </div>
              </div>

              <div className="hidden md:block md:w-[15rem] lg:w-[16rem]">
                <PromptModeSelect />
              </div>
            </div>

            <div className="mt-4 hidden lg:block">
              <div className="grid gap-3 xl:grid-cols-4">
                {monitorCards.map(({ detail, icon: Icon, label, tone, value }) => (
                  <div
                    key={label}
                    className="rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(247,241,255,0.9)_100%)] p-4 shadow-[0_12px_30px_rgba(73,56,145,0.08)]"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                        tone === "warn"
                          ? "bg-[#fff0eb] text-[#d66b50]"
                          : tone === "good"
                            ? "bg-[#ebfff2] text-[#31a05f]"
                            : tone === "active"
                              ? "bg-[#eef0ff] text-[#5b63f6]"
                              : "bg-[#f0ebff] text-[#7267f3]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--aui-muted-foreground))]">
                      {label}
                    </p>
                    <p className="mt-1 text-base font-semibold text-[#1f1838]">
                      {value}
                    </p>
                    <p className="mt-1 text-sm text-[hsl(var(--aui-muted-foreground))]">
                      {detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 md:hidden">
              <PromptModeSelect />
            </div>

            {!systemState.canChat || monitor.data?.queue.lastError ? (
              <div className="mt-3 flex items-start gap-3 rounded-[20px] border border-[#ffd8cd] bg-[#fff7f3] px-4 py-3 text-sm text-[#7a4a3d] lg:hidden">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>{systemState.message}</p>
                  {monitor.data?.queue.lastError ? (
                    <p className="mt-1 text-xs">{monitor.data.queue.lastError}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-2 sm:px-3 sm:pb-3 lg:px-4 lg:pb-4">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.6)_0%,rgba(250,247,255,0.9)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_45px_rgba(73,56,145,0.08)]">
              <Thread
                welcome={{
                  message:
                    "Describe the image, prompt, or workflow you want to build.",
                }}
                components={{
                  AssistantMessage: CustomAssistantMessage,
                  Composer: ManagedComposer,
                  UserMessage: CustomUserMessage,
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function useSystemMonitor() {
  const [data, setData] = useState<MonitorState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const response = await fetch("/api/system/monitor", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to fetch system monitor");
        }

        const nextData = (await response.json()) as MonitorState;
        if (!cancelled) {
          setData(nextData);
        }
      } catch {
        if (!cancelled) {
          setData((previous) => previous);
        }
      }
    };

    void sync();
    const intervalId = window.setInterval(sync, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return { data };
}

function formatVramUsage(usedMb: number | null, totalMb: number | null) {
  if (usedMb === null || totalMb === null || totalMb <= 0) {
    return "Unavailable";
  }

  return `${Math.round(usedMb / 1024)} / ${Math.round(totalMb / 1024)} GB`;
}

function getVramUsageRatio(usedMb: number | null, totalMb: number | null) {
  if (usedMb === null || totalMb === null || totalMb <= 0) {
    return 0;
  }

  return usedMb / totalMb;
}

function formatGpuTemperature(temperatureC: number | null) {
  if (temperatureC === null) {
    return "nvidia-smi not available";
  }

  return `${temperatureC}°C`;
}

function SidebarPanel({
  isMobile = false,
  onCollapse,
}: Readonly<{
  isMobile?: boolean;
  onCollapse: () => void;
}>) {
  return (
    <div
      className={`flex h-full min-h-0 flex-col ${
        isMobile
          ? "border-r border-[hsl(var(--aui-border))]/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(246,240,255,0.96)_100%)] p-4 shadow-[0_24px_60px_rgba(37,28,86,0.24)]"
          : "p-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] text-sm font-semibold text-white shadow-[0_14px_32px_rgba(98,87,210,0.28)]">
            CB
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1f1838]">Threads</p>
            <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
              Recent sessions and prompt experiments
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/78 text-[hsl(var(--aui-foreground))] shadow-[0_10px_20px_rgba(73,56,145,0.08)] transition hover:bg-white"
          aria-label={isMobile ? "Close threads" : "Collapse sidebar"}
        >
          {isMobile ? <X className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-4 rounded-[22px] border border-white/70 bg-white/76 px-3 py-3 text-sm text-[hsl(var(--aui-muted-foreground))] shadow-[0_12px_28px_rgba(73,56,145,0.08)]">
        Recent sessions.
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/70 bg-white/72 p-2 shadow-[0_14px_34px_rgba(73,56,145,0.08)]">
        <ThreadList.Root>
          <ThreadList.New />
          <ThreadList.Items
            components={{
              ThreadListItem: CustomThreadListItem,
            }}
          />
        </ThreadList.Root>
      </div>
    </div>
  );
}
