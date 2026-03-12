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
    <ThreadListItemPrimitive.Root className="group/thread-item flex items-center gap-2 rounded-2xl border border-transparent pr-1 transition hover:border-[hsl(var(--aui-border))] hover:bg-[hsl(var(--aui-muted))] data-[active]:border-[hsl(var(--aui-border))] data-[active]:bg-[hsl(var(--aui-muted))]">
      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-left">
        <ThreadListItemPrimitive.Title fallback="New Chat" className="truncate text-sm" />
      </ThreadListItemPrimitive.Trigger>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--aui-muted-foreground))] transition hover:bg-[hsl(var(--aui-background))] hover:text-[hsl(var(--aui-foreground))]"
          aria-label="Thread actions"
        >
          <Ellipsis className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-10 z-20 min-w-44 overflow-hidden rounded-xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] p-1 shadow-xl">
            {isArchived ? (
              <ThreadListItemPrimitive.Unarchive
                asChild
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[hsl(var(--aui-muted))]"
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
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[hsl(var(--aui-muted))]"
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
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
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
