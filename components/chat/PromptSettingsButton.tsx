"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import * as Tabs from "@radix-ui/react-tabs";
import { Expand, Loader2, Plus, Settings2, Trash2, X } from "lucide-react";

import { MOODS_UPDATED_EVENT } from "@/components/chat/mood";
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

type EditableMood = {
  id: string;
  label: string;
  prompt: string;
};

type MoodSettingsResponse = {
  moods: EditableMood[];
};

type EditableUtilTask = {
  name: string;
  prompt: string;
  enabled: boolean;
  mcpServers: Array<
    "comfy" | "comfy_readonly" | "web_search" | "civitai" | "memory"
  >;
};


const utilTaskMcpOptions: Array<{
  value: "comfy" | "comfy_readonly" | "web_search" | "civitai" | "memory";
  label: string;
}> = [
  { value: "comfy", label: "Comfy (Full)" },
  { value: "comfy_readonly", label: "Comfy (No Generate)" },
  { value: "web_search", label: "Web Search" },
  { value: "civitai", label: "Civitai" },
  { value: "memory", label: "Memory KB" },
];
type UtilTaskSettingsResponse = {
  tasks: EditableUtilTask[];
  defaults: Record<string, string>;
};

const createUtilTaskName = (tasks: EditableUtilTask[]) => {
  let index = 1;

  while (true) {
    const candidate = `util_task_${index}`;
    const exists = tasks.some((task) => task.name === candidate);
    if (!exists) {
      return candidate;
    }
    index += 1;
  }
};
type UtilTaskEditorProps = {
  index: number;
  task: EditableUtilTask;
  onUpdate: (index: number, input: Partial<EditableUtilTask>) => void;
  onRemove: (index: number) => void;
  onRestoreDefault: (name: string) => void;
};

const UtilTaskEditor = ({
  index,
  task,
  onUpdate,
  onRemove,
  onRestoreDefault,
}: UtilTaskEditorProps) => {
  const [localName, setLocalName] = useState(task.name);
  const [localPrompt, setLocalPrompt] = useState(task.prompt);

  useEffect(() => {
    setLocalName(task.name);
  }, [task.name]);

  useEffect(() => {
    setLocalPrompt(task.prompt);
  }, [task.prompt]);

  return (
    <div className="rounded-[14px] border border-white/70 bg-white/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={localName}
          onChange={(event) => setLocalName(event.target.value)}
          onBlur={() => {
            if (localName !== task.name) {
              onUpdate(index, { name: localName });
            }
          }}
          className="min-w-[220px] flex-1 rounded-full border border-[hsl(var(--aui-border))] bg-white px-3 py-1.5 text-sm text-[#2a2146] outline-none focus:border-[#8b7cff]"
          placeholder="util task name"
        />
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))]">
            <input
              type="checkbox"
              checked={task.enabled}
              onChange={(event) =>
                onUpdate(index, {
                  enabled: event.target.checked,
                })
              }
              className="h-3.5 w-3.5"
            />
            Enabled
          </label>
          <button
            type="button"
            onClick={() => onRestoreDefault(task.name)}
            className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
          >
            Restore Default
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="inline-flex items-center gap-1 rounded-full border border-[#efc7ce] bg-[#fff5f7] px-3 py-1 text-xs font-medium text-[#b34558] transition hover:bg-[#ffecef]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {utilTaskMcpOptions.map((option) => {
          const isChecked = task.mcpServers.includes(option.value);
          return (
            <label
              key={option.value}
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))]"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...task.mcpServers, option.value]
                    : task.mcpServers.filter((value) => value !== option.value);
                  onUpdate(index, { mcpServers: Array.from(new Set(next)) });
                }}
                className="h-3.5 w-3.5"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      <textarea
        value={localPrompt}
        onChange={(event) => setLocalPrompt(event.target.value)}
        onBlur={() => {
          if (localPrompt !== task.prompt) {
            onUpdate(index, { prompt: localPrompt });
          }
        }}
        className="mt-2 min-h-[140px] w-full resize-y rounded-[12px] border border-[hsl(var(--aui-border))] bg-white px-3 py-2 text-base leading-6 text-[#2a2146] caret-[#2a2146] shadow-[inset_0_1px_1px_rgba(31,24,56,0.04)] outline-none focus:border-[#8b7cff] md:text-sm"
      />
    </div>
  );
};
const createMoodId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // Some browsers expose randomUUID but block it in non-secure contexts.
    }
  }

  return `mood-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function PromptSettingsButton() {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [activeTab, setActiveTab] = useState<"modes" | "moods" | "utilTasks">("modes");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAllChats, setDeletingAllChats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<Record<PromptMode, string> | null>(null);
  const [defaults, setDefaults] = useState<Record<PromptMode, string> | null>(null);
  const [moods, setMoods] = useState<EditableMood[] | null>(null);
  const [utilTasks, setUtilTasks] = useState<EditableUtilTask[] | null>(null);
  const [utilTaskDefaults, setUtilTaskDefaults] = useState<Record<string, string>>({});
  const [expandedMode, setExpandedMode] = useState<PromptMode | null>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setIsMobileViewport(media.matches);
    };

    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setExpandedMode(null);
      setActiveTab("modes");
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const [promptResponse, moodResponse, utilTaskResponse] = await Promise.all([
          fetch("/api/settings/system-prompts", {
            cache: "no-store",
          }),
          fetch("/api/settings/moods", {
            cache: "no-store",
          }),
          fetch("/api/settings/util-tasks", {
            cache: "no-store",
          }),
        ]);

        if (!promptResponse.ok) {
          throw new Error("Failed to load prompt settings.");
        }

        if (!moodResponse.ok) {
          throw new Error("Failed to load mood settings.");
        }

        if (!utilTaskResponse.ok) {
          throw new Error("Failed to load util task settings.");
        }

        const promptData = (await promptResponse.json()) as PromptSettingsResponse;
        const moodData = (await moodResponse.json()) as MoodSettingsResponse;
        const utilTaskData =
          (await utilTaskResponse.json()) as UtilTaskSettingsResponse;

        if (!cancelled) {
          setPrompts(promptData.prompts);
          setDefaults(promptData.defaults);
          setMoods(moodData.moods);
          setUtilTasks(utilTaskData.tasks);
          setUtilTaskDefaults(utilTaskData.defaults);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load settings.",
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
    () => !!prompts && !!moods && !!utilTasks && !loading && !saving,
    [prompts, moods, utilTasks, loading, saving],
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

  const updateMood = (id: string, input: Partial<EditableMood>) => {
    setMoods((previous) => {
      if (!previous) {
        return previous;
      }

      return previous.map((mood) =>
        mood.id === id
          ? {
              ...mood,
              ...input,
            }
          : mood,
      );
    });
  };

  const addMood = () => {
    setMoods((previous) => {
      if (!previous) {
        return previous;
      }

      return [
        ...previous,
        {
          id: createMoodId(),
          label: "New Mood",
          prompt: "",
        },
      ];
    });
  };

  const removeMood = (id: string) => {
    setMoods((previous) => {
      if (!previous) {
        return previous;
      }

      return previous.filter((mood) => mood.id !== id);
    });
  };

  const updateUtilTask = (index: number, input: Partial<EditableUtilTask>) => {
    setUtilTasks((previous) => {
      if (!previous) {
        return previous;
      }

      return previous.map((task, taskIndex) =>
        taskIndex === index
          ? {
              ...task,
              ...input,
            }
          : task,
      );
    });
  };

  const restoreUtilTaskDefault = (name: string) => {
    const defaultPrompt = utilTaskDefaults[name];
    if (typeof defaultPrompt !== "string") {
      return;
    }

    setUtilTasks((previous) => {
      if (!previous) {
        return previous;
      }

      return previous.map((task) =>
        task.name === name
          ? {
              ...task,
              prompt: defaultPrompt,
            }
          : task,
      );
    });
  };

  const addUtilTask = () => {
    setUtilTasks((previous) => {
      if (!previous) {
        return previous;
      }

      return [
        ...previous,
        {
          name: createUtilTaskName(previous),
          prompt: "",
          enabled: true,
          mcpServers: [],
        },
      ];
    });
  };

  const removeUtilTask = (index: number) => {
    setUtilTasks((previous) => {
      if (!previous) {
        return previous;
      }

      return previous.filter((_, taskIndex) => taskIndex !== index);
    });
  };

  const save = async () => {
    if (!prompts || !moods || !utilTasks) {
      return;
    }

    const normalizedUtilTasks = utilTasks
      .map((task) => ({
        ...task,
        name: task.name.trim(),
        mcpServers: Array.from(new Set(task.mcpServers ?? [])),
      }))
      .filter((task) => task.name.length > 0);
    const uniqueNames = new Set(normalizedUtilTasks.map((task) => task.name));
    if (uniqueNames.size !== normalizedUtilTasks.length) {
      setError("Util task names must be unique.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSavedAt(null);

      const [promptResponse, moodResponse, utilTaskResponse] = await Promise.all([
        fetch("/api/settings/system-prompts", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompts,
          }),
        }),
        fetch("/api/settings/moods", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            moods,
          }),
        }),
        fetch("/api/settings/util-tasks", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tasks: normalizedUtilTasks,
          }),
        }),
      ]);

      if (!promptResponse.ok) {
        throw new Error("Failed to save prompt settings.");
      }

      if (!moodResponse.ok) {
        throw new Error("Failed to save mood settings.");
      }

      if (!utilTaskResponse.ok) {
        throw new Error("Failed to save util task settings.");
      }

      const promptData = (await promptResponse.json()) as {
        prompts: Record<PromptMode, string>;
      };
      const moodData = (await moodResponse.json()) as MoodSettingsResponse;
      const utilTaskData =
        (await utilTaskResponse.json()) as { tasks: EditableUtilTask[] };

      setPrompts(promptData.prompts);
      setMoods(moodData.moods);
      setUtilTasks(utilTaskData.tasks);
      setSavedAt(new Date().toISOString());
      window.dispatchEvent(new Event(MOODS_UPDATED_EVENT));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to save settings.",
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

  const modal = (
    <div className="fixed inset-0 z-[70] pointer-events-none">
      <button
        type="button"
        aria-label="Close settings overlay"
        onClick={() => setOpen(false)}
        className="pointer-events-auto absolute inset-0 z-0 bg-[#1d1738]/35 backdrop-blur-sm"
      />
      <div className="pointer-events-auto absolute inset-0 z-10 h-[100dvh] w-full overflow-hidden border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,239,255,0.98)_100%)] outline-none md:left-1/2 md:top-1/2 md:h-[min(88vh,860px)] md:w-[min(960px,94vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:border md:border-white/70 md:shadow-[0_28px_80px_rgba(37,28,86,0.3)]">
        <Tabs.Root
          value={activeTab}
          onValueChange={(value) => {
            if (value === "modes" || value === "moods" || value === "utilTasks") {
              setActiveTab(value);
            }
            closeExpandedMode();
          }}
          className="flex h-full flex-col"
        >
          <div className="flex items-center justify-between border-b border-white/70 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[#1f1838]">
                Mode, Mood, And Util Task Prompts
              </h2>
              <p className="text-sm text-[hsl(var(--aui-muted-foreground))]">
                Edit mode prompts, mood overlays, and utility task prompts.
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

          <Tabs.List className="mx-5 mt-4 flex items-center gap-2 rounded-t-[18px] border border-white/70 bg-white/80 px-3 py-2">
            <Tabs.Trigger
              value="modes"
              className="rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-semibold text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff] data-[state=active]:border-transparent data-[state=active]:bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] data-[state=active]:text-white"
            >
              Modes
            </Tabs.Trigger>
            <Tabs.Trigger
              value="moods"
              className="rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-semibold text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff] data-[state=active]:border-transparent data-[state=active]:bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] data-[state=active]:text-white"
            >
              Moods
            </Tabs.Trigger>
            <Tabs.Trigger
              value="utilTasks"
              className="rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-semibold text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff] data-[state=active]:border-transparent data-[state=active]:bg-[linear-gradient(135deg,#7f74ff_0%,#b7adff_100%)] data-[state=active]:text-white"
            >
              Util Tasks
            </Tabs.Trigger>
          </Tabs.List>

          <div
            className="mx-5 mb-4 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-[18px] border-x border-b border-white/70 bg-white/68 px-4 py-4"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {loading || !prompts || !moods || !utilTasks ? (
              <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--aui-muted-foreground))]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading settings...
              </div>
            ) : (
              <div className="space-y-4">

                <Tabs.Content value="modes" className="space-y-4">
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
                </Tabs.Content>

                <Tabs.Content value="moods" className="space-y-4">
                  <div className="rounded-[20px] border border-white/70 bg-white/85 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-[#1f1838]">
                          Moods
                        </h3>
                        <p className="mt-0.5 text-xs text-[hsl(var(--aui-muted-foreground))]">
                          Dynamic style overlays. Add, edit, or remove as needed.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addMood}
                        className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Mood
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {moods.length === 0 ? (
                        <p className="rounded-[14px] border border-dashed border-white/70 bg-white/70 px-3 py-3 text-xs text-[hsl(var(--aui-muted-foreground))]">
                          No moods configured. Add one to make it selectable in chat.
                        </p>
                      ) : null}

                      {moods.map((mood) => (
                        <div
                          key={mood.id}
                          className="rounded-[14px] border border-white/70 bg-white/80 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={mood.label}
                              onChange={(event) =>
                                updateMood(mood.id, { label: event.target.value })
                              }
                              className="min-w-[220px] flex-1 rounded-full border border-[hsl(var(--aui-border))] bg-white px-3 py-1.5 text-sm text-[#2a2146] outline-none focus:border-[#8b7cff]"
                              placeholder="Mood name"
                            />
                            <button
                              type="button"
                              onClick={() => removeMood(mood.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-[#efc7ce] bg-[#fff5f7] px-3 py-1 text-xs font-medium text-[#b34558] transition hover:bg-[#ffecef]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>
                          <textarea
                            value={mood.prompt}
                            onChange={(event) =>
                              updateMood(mood.id, { prompt: event.target.value })
                            }
                            className="mt-2 min-h-[120px] w-full resize-y rounded-[12px] border border-[hsl(var(--aui-border))] bg-white px-3 py-2 text-base leading-6 text-[#2a2146] caret-[#2a2146] shadow-[inset_0_1px_1px_rgba(31,24,56,0.04)] outline-none focus:border-[#8b7cff] md:text-sm"
                            placeholder="Mood prompt overlay"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </Tabs.Content>

                <Tabs.Content value="utilTasks" className="space-y-4">
                  <div className="rounded-[20px] border border-white/70 bg-white/85 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-[#1f1838]">
                          Util Tasks
                        </h3>
                        <p className="mt-0.5 text-xs text-[hsl(var(--aui-muted-foreground))]">
                          Task-specific prompts executed from stream commands.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addUtilTask}
                        className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--aui-foreground))] transition hover:bg-[#f7f2ff]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Util Task
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {utilTasks.length === 0 ? (
                        <p className="rounded-[14px] border border-dashed border-white/70 bg-white/70 px-3 py-3 text-xs text-[hsl(var(--aui-muted-foreground))]">
                          No util tasks configured.
                        </p>
                      ) : null}

                      {utilTasks.map((task, index) => (
                        <UtilTaskEditor
                          key={`${task.name}-${index}`}
                          index={index}
                          task={task}
                          onUpdate={updateUtilTask}
                          onRemove={removeUtilTask}
                          onRestoreDefault={restoreUtilTaskDefault}
                        />
                      ))}
                    </div>
                  </div>
                </Tabs.Content>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-[1] flex items-center justify-between border-t border-white/70 bg-[linear-gradient(180deg,rgba(250,247,255,0.82)_0%,rgba(244,239,255,0.98)_100%)] px-5 py-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void deleteAllChats()}
                disabled={deletingAllChats || saving || loading}
                className="inline-flex items-center justify-center rounded-full border border-[#efc7ce] bg-[#fff5f7] px-3 py-1.5 text-xs font-semibold text-[#b34558] transition hover:bg-[#ffecef] disabled:cursor-not-allowed disabled:opacity-65"
              >
                {deletingAllChats ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete All Chats"
                )}
              </button>
              <div className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                {error
                  ? error
                  : savedAt
                    ? `Saved at ${new Date(savedAt).toLocaleTimeString()}`
                    : "Changes apply to new model requests."}
              </div>
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
        </Tabs.Root>

        {activeTab === "modes" && expandedMode && prompts ? (
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
  );

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

      {open && typeof document !== "undefined"
        ? isMobileViewport
          ? modal
          : createPortal(modal, document.body)
        : null}
    </>
  );
}



