"use client";

import { Archive, Ellipsis, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ThreadListItemPrimitive, useAui } from "@assistant-ui/react";

export function CustomThreadListItem() {
  const aui = useAui();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { status } = aui.threadListItem().getState();
  const isArchived = status === "archived";

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
    <ThreadListItemPrimitive.Root className="group/thread-item relative flex items-center gap-2 overflow-hidden rounded-[10px] border border-transparent bg-transparent pl-4 pr-1 transition hover:border-white/50 hover:bg-[rgba(255,255,255,0.42)] data-[active]:border-[rgba(139,124,255,0.22)] data-[active]:bg-[linear-gradient(90deg,rgba(127,116,255,0.24)_0%,rgba(183,173,255,0.16)_36%,rgba(255,255,255,0.12)_100%)]">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[linear-gradient(180deg,#7f74ff_0%,#b7adff_100%)] opacity-0 transition-opacity duration-200 group-data-[active]/thread-item:opacity-100" />

      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 px-3 py-3 text-left">
        <p className="overflow-hidden whitespace-nowrap text-[15px]  font-medium leading-5 text-[#2a2146] transition-colors [mask-image:linear-gradient(90deg,#000_0%,#000_82%,transparent_100%)] [-webkit-mask-image:linear-gradient(90deg,#000_0%,#000_82%,transparent_100%)] group-data-[active]/thread-item:text-[#1f1838]">
          <ThreadListItemPrimitive.Title fallback="New Chat" />
        </p>
      </ThreadListItemPrimitive.Trigger>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[hsl(var(--aui-muted-foreground))] transition hover:bg-white/70 hover:text-[hsl(var(--aui-foreground))]"
          aria-label="Thread actions"
        >
          <Ellipsis className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-11 z-20 min-w-44 overflow-hidden rounded-[18px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(245,240,255,0.96)_100%)] p-1.5 shadow-[0_24px_60px_rgba(37,28,86,0.2)]">
            {isArchived ? (
              <ThreadListItemPrimitive.Unarchive
                asChild
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm transition hover:bg-white/80"
                >
                  <RotateCcw className="h-4 w-4" />
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
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm transition hover:bg-white/80"
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </button>
              </ThreadListItemPrimitive.Archive>
            )}

            <ThreadListItemPrimitive.Delete
              asChild
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete Permanently
              </button>
            </ThreadListItemPrimitive.Delete>
          </div>
        ) : null}
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
