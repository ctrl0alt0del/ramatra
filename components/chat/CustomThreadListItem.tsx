"use client";

import { Archive, Ellipsis, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ThreadListItemPrimitive, useAui } from "@assistant-ui/react";

import { useThreadEvents } from "./thread-events";

export function CustomThreadListItem() {
  const aui = useAui();
  const { byId } = useThreadEvents();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { remoteId, status, title } = aui.threadListItem().getState();
  const isArchived = status === "archived";
  const streamedTitle = remoteId ? byId[remoteId]?.title : undefined;
  const displayTitle = streamedTitle?.trim() || title?.trim() || "New Chat";

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <ThreadListItemPrimitive.Root className="group/thread-item relative flex items-center gap-2 overflow-visible rounded-[14px] border-0 !border-transparent bg-transparent py-1.5 pl-4 pr-1 transition-all duration-200 hover:bg-[rgba(255,255,255,0.55)] data-[active]:!border-transparent data-[active]:!outline-none data-[active]:bg-[linear-gradient(95deg,rgba(127,116,255,0.28)_0%,rgba(183,173,255,0.2)_44%,rgba(255,255,255,0.14)_100%)] data-[active]:shadow-[0_10px_24px_rgba(73,56,145,0.16)]">
      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 px-3 py-5 text-left">
        <p className="overflow-hidden whitespace-nowrap text-[15px] font-medium leading-5 text-[#2a2146] transition-colors [mask-image:linear-gradient(90deg,#000_0%,#000_84%,transparent_100%)] [-webkit-mask-image:linear-gradient(90deg,#000_0%,#000_84%,transparent_100%)] group-data-[active]/thread-item:font-semibold group-data-[active]/thread-item:text-[#1f1838]">
          {displayTitle}
        </p>
      </ThreadListItemPrimitive.Trigger>

      <div ref={menuRef} className="relative z-10 shrink-0">
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[hsl(var(--aui-muted-foreground))] opacity-75 transition-all hover:border-white/70 hover:bg-white/80 hover:text-[hsl(var(--aui-foreground))] hover:opacity-100 group-hover/thread-item:opacity-100 group-data-[active]/thread-item:border-white/60 group-data-[active]/thread-item:bg-white/78 group-data-[active]/thread-item:text-[#2a2146] group-data-[active]/thread-item:shadow-[0_6px_14px_rgba(73,56,145,0.1)]"
          aria-label="Thread actions"
        >
          <Ellipsis className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div
            className="absolute right-1 top-[calc(100%+0.5rem)] z-30 w-56 overflow-hidden rounded-[18px] border border-[rgba(139,124,255,0.22)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(244,239,255,0.98)_100%)] p-2.5 shadow-[0_20px_46px_rgba(37,28,86,0.2)] backdrop-blur-xl"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="space-y-2">
              {isArchived ? (
                <ThreadListItemPrimitive.Unarchive
                  asChild
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-[13px] font-medium text-[#2a2146] transition hover:bg-white/86"
                  >
                    <RotateCcw className="h-4 w-4 text-[#6e5bff]" />
                    Unarchive
                  </button>
                </ThreadListItemPrimitive.Unarchive>
              ) : (
                <ThreadListItemPrimitive.Archive
                  asChild
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-[13px] font-medium text-[#2a2146] transition hover:bg-white/86"
                  >
                    <Archive className="h-4 w-4 text-[#6e5bff]" />
                    Archive
                  </button>
                </ThreadListItemPrimitive.Archive>
              )}

              <div className="my-2.5 border-t border-white/70" />

              <ThreadListItemPrimitive.Delete
                asChild
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-[13px] font-medium text-[#c64f63] transition hover:bg-[#fff1f3]"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </ThreadListItemPrimitive.Delete>
            </div>
          </div>
        ) : null}
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
