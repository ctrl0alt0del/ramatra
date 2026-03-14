"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Expand, Loader2, Settings2, X } from "lucide-react";

import {
  promptModeDescriptions,
  promptModeLabels,
  promptModes,
  type PromptMode,
} from "@/lib/lmstudio/prompt-modes";

type PromptSettingsResponse = {
  prompts: Record<PromptMode, string>;
  defaults: Record<PromptMode, string>;
};

export function PromptSettingsButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAllChats, setDeletingAllChats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<Record<PromptMode, string> | null>(null);
  const [defaults, setDefaults] = useState<Record<PromptMode, string> | null>(null);
  const [expandedMode, setExpandedMode] = useState<PromptMode | null>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      setExpandedMode(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/settings/system-prompts", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load prompt settings.");
        }

        const data = (await response.json()) as PromptSettingsResponse;
        if (!cancelled) {
          setPrompts(data.prompts);
          setDefaults(data.defaults);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load prompt settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (expandedMode) {
          closeExpandedMode();
          return;
        }
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, expandedMode]);

  useEffect(() => {
    if (!expandedMode) {
      return;
    }

    const textarea = expandedTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.focus();
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, [expandedMode]);

  const canSave = useMemo(
    () => !!prompts && !loading && !saving,
    [prompts, loading, saving],
  );

  const updateModePrompt = (mode: PromptMode, value: string) => {
    setPrompts((previous) => {
      if (!previous) {
        return previous;
      }

      return {
        ...previous,
        [mode]: value,
      };
    });
  };

  const restoreDefault = (mode: PromptMode) => {
    if (!defaults) {
      return;
    }

    updateModePrompt(mode, defaults[mode]);
  };

  const save = async () => {
    if (!prompts) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSavedAt(null);

      const response = await fetch("/api/settings/system-prompts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompts,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save prompt settings.");
      }

      const data = (await response.json()) as { prompts: Record<PromptMode, string> };
      setPrompts(data.prompts);
      setSavedAt(new Date().toISOString());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to save prompt settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const selectAllExpandedPrompt = () => {
    const textarea = expandedTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
  };

  const deleteAllChats = async () => {
    if (deletingAllChats) {
      return;
    }

    const confirmed = window.confirm(
      "Delete all chats? This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeletingAllChats(true);
      setError(null);
      setSavedAt(null);

      const response = await fetch("/api/threads", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete all chats.");
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to delete all chats.",
      );
    } finally {
      setDeletingAllChats(false);
    }
  };

  const closeExpandedMode = () => {
    expandedTextareaRef.current?.blur();
    setExpandedMode(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/78 text-[hsl(var(--aui-foreground))] shadow-[0_10px_20px_rgba(73,56,145,0.08)] transition hover:bg-white"
        aria-label="Open settings"
      >
        <Settings2 className="h-4 w-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            aria-label="Close settings overlay"
            onClick={() => setOpen(false)}
            className="absolute inset-0 z-0 bg-[#1d1738]/35 backdrop-blur-sm"
          />
          <div className="absolute inset-0 z-10 h-[100dvh] w-full overflow-hidden border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,239,255,0.98)_100%)] outline-none md:left-1/2 md:top-1/2 md:h-[min(88vh,860px)] md:w-[min(960px,94vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:border md:border-white/70 md:shadow-[0_28px_80px_rgba(37,28,86,0.3)]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-white/70 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1f1838]">
                  Mode System Prompts
                </h2>
                <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
                  Edit prompts for Fast, Regular, Writer, and Artist modes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/70 bg-white/85 text-[hsl(var(--aui-foreground))] transition hover:bg-white"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {loading || !prompts ? (
                <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--aui-muted-foreground))]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading prompt settings...
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-[20px] border border-[#efc7ce] bg-[#fff5f7] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[#7b2334]">
                        Danger Zone
                      </h3>
                      <p className="mt-0.5 text-xs text-[#a74b5d]">
                        Permanently remove all chat threads and messages.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteAllChats()}
                      disabled={deletingAllChats || saving || loading}
                      className="inline-flex items-center justify-center rounded-full border border-[#efc7ce] bg-[#fff5f7] px-4 py-2 text-sm font-semibold text-[#b34558] transition hover:bg-[#ffecef] disabled:cursor-not-allowed disabled:opacity-65"
                    >
                      {deletingAllChats ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        "Delete All Chats"
                      )}
                    </button>
                  </div>
                  {promptModes.map((mode) => (
                    <div
                      key={mode}
                      className="rounded-[20px] border border-white/70 bg-white/85 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-[#1f1838]">
                            {promptModeLabels[mode]}
                          </h3>
                          <p className="mt-0.5 text-xs text-[hsl(var(--aui-muted-foreground))]">
                            {promptModeDescriptions[mode]}
                          </p>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                          <button
                            type="button"
                            onClick={() => setExpandedMode(mode)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                          >
                            <Expand className="h-3.5 w-3.5" />
                            Expand
                          </button>
                          <button
                            type="button"
                            onClick={() => restoreDefault(mode)}
                            className="shrink-0 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                          >
                            Restore Default
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={prompts[mode]}
                        onChange={(event) => updateModePrompt(mode, event.target.value)}
                        className="mt-3 min-h-[180px] w-full resize-y rounded-[14px] border border-[hsl(var(--aui-border))] bg-white px-3 py-2 text-base leading-6 text-[#2a2146] caret-[#2a2146] shadow-[inset_0_1px_1px_rgba(31,24,56,0.04)] outline-none focus:border-[#8b7cff] md:text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 z-[1] flex items-center justify-between border-t border-white/70 bg-[linear-gradient(180deg,rgba(250,247,255,0.82)_0%,rgba(244,239,255,0.98)_100%)] px-5 py-4 backdrop-blur-sm">
              <div className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                {error
                  ? error
                  : savedAt
                    ? `Saved at ${new Date(savedAt).toLocaleTimeString()}`
                    : "Changes apply to new model requests."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-white/70 bg-white px-4 py-2 text-sm font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!canSave}
                  className="inline-flex items-center rounded-full bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(73,56,145,0.2)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Prompts"
                  )}
                </button>
              </div>
            </div>
          </div>
          {open && expandedMode && prompts ? (
            <div className="absolute inset-0 z-10 flex h-full w-full flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.995)_0%,rgba(244,239,255,0.995)_100%)]">
              <div className="flex items-center justify-between border-b border-white/70 px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-[#1f1838]">
                    {promptModeLabels[expandedMode]} Prompt
                  </h3>
                  <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                    Fullscreen editor
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllExpandedPrompt}
                    className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={closeExpandedMode}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/70 bg-white/85 text-[hsl(var(--aui-foreground))] transition hover:bg-white"
                    aria-label="Close fullscreen editor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 px-4 py-3">
                <textarea
                  ref={expandedTextareaRef}
                  value={prompts[expandedMode]}
                  onChange={(event) =>
                    updateModePrompt(expandedMode, event.target.value)
                  }
                  className="h-full min-h-full w-full resize-none overflow-y-auto rounded-[16px] border border-[hsl(var(--aui-border))] bg-white px-3 py-3 text-base leading-6 text-[#2a2146] caret-[#2a2146] shadow-[inset_0_1px_1px_rgba(31,24,56,0.04)] outline-none focus:border-[#8b7cff]"
                  style={{ WebkitOverflowScrolling: "touch" }}
                />
              </div>
            </div>
          ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
