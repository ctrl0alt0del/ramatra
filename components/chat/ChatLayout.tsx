"use client";

import { useState } from "react";

import * as Dialog from "@radix-ui/react-dialog";
import { PanelLeft, X } from "lucide-react";
import { Thread, ThreadList } from "@assistant-ui/react-ui";

import { CustomAssistantMessage } from "./CustomAssistantMessage";
import { CustomThreadListItem } from "./CustomThreadListItem";
import { CustomUserMessage } from "./CustomUserMessage";
import { ManagedComposer } from "./ManagedComposer";
import { PromptModeSelect } from "./prompt-mode";
import { SystemStateProvider } from "./system-state";

export function ChatLayout() {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <SystemStateProvider>
      <div className="aui-root flex h-[100dvh] w-full overflow-hidden bg-[hsl(var(--aui-background))] text-[hsl(var(--aui-foreground))]">
        <aside
          className={`hidden h-full shrink-0 border-r border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] transition-[width,padding] duration-200 md:flex md:flex-col ${
            desktopSidebarOpen ? "md:w-80 md:p-4" : "md:w-0 md:px-0 md:py-4"
          }`}
        >
          <div
            className={`flex h-full min-h-0 flex-col overflow-hidden ${
              desktopSidebarOpen
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            } transition-opacity duration-150`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Threads</p>
                <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                  Recent conversations
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDesktopSidebarOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] text-[hsl(var(--aui-foreground))] transition hover:bg-[hsl(var(--aui-muted))]"
                aria-label="Collapse sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
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
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--aui-border))] px-3 py-2 md:px-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDesktopSidebarOpen((open) => !open)}
                className="hidden h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] text-[hsl(var(--aui-foreground))] transition hover:bg-[hsl(var(--aui-muted))] md:inline-flex"
                aria-label={desktopSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                <PanelLeft className="h-4 w-4" />
              </button>

              <Dialog.Root
                open={mobileSidebarOpen}
                onOpenChange={setMobileSidebarOpen}
              >
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] text-[hsl(var(--aui-foreground))] transition hover:bg-[hsl(var(--aui-muted))] md:hidden"
                    aria-label="Open threads"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                </Dialog.Trigger>

                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm md:hidden" />
                  <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(22rem,88vw)] flex-col border-r border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] p-4 shadow-2xl outline-none md:hidden">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <Dialog.Title className="text-sm font-semibold">
                          Threads
                        </Dialog.Title>
                        <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                          Recent conversations
                        </p>
                      </div>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--aui-border))] text-[hsl(var(--aui-foreground))] transition hover:bg-[hsl(var(--aui-muted))]"
                          aria-label="Close threads"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Dialog.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <ThreadList.Root>
                        <ThreadList.New />
                        <ThreadList.Items
                          components={{
                            ThreadListItem: CustomThreadListItem,
                          }}
                        />
                      </ThreadList.Root>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>

              <div>
                <p className="text-sm font-semibold">Comfy Bridge</p>
                <p className="text-xs text-[hsl(var(--aui-muted-foreground))] md:hidden">
                  Chat and image generation
                </p>
              </div>
            </div>

            <div className="hidden md:block">
              <PromptModeSelect />
            </div>
          </div>

          <div className="border-b border-[hsl(var(--aui-border))] px-3 py-2 md:hidden">
            <PromptModeSelect />
          </div>

          <div className="min-h-0 flex-1">
            <Thread
              welcome={{
                message: "Hi. Describe the image you want to generate.",
              }}
              components={{
                AssistantMessage: CustomAssistantMessage,
                Composer: ManagedComposer,
                UserMessage: CustomUserMessage,
              }}
            />
          </div>
        </section>
      </div>
    </SystemStateProvider>
  );
}
