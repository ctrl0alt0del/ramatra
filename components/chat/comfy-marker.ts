export const COMFY_JOB_MARKER_PREFIX = "[[COMFY_JOB:";
export const COMFY_JOB_MARKER_SUFFIX = "]]";

export type ComfyJobMarker = {
  jobId: string;
  status: "queued" | "running";
  workflowName: string;
};

const parseNestedMarker = (rawMarker: string): ComfyJobMarker | null => {
  let current: unknown = rawMarker;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isComfyJobMarker(current)) {
      return current;
    }

    if (typeof current !== "string") {
      return null;
    }

    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }

  return isComfyJobMarker(current) ? current : null;
};

const isComfyJobMarker = (value: unknown): value is ComfyJobMarker => {
  if (!value || typeof value !== "object") return false;

  const marker = value as Record<string, unknown>;
  return (
    typeof marker.jobId === "string" &&
    marker.jobId.trim().length > 0 &&
    (marker.status === "queued" || marker.status === "running") &&
    typeof marker.workflowName === "string" &&
    marker.workflowName.trim().length > 0
  );
};

export const encodeComfyJobMarker = (marker: ComfyJobMarker) =>
  `${COMFY_JOB_MARKER_PREFIX}${JSON.stringify(marker)}${COMFY_JOB_MARKER_SUFFIX}`;

export const extractComfyJobMarker = (text: string) => {
  const start = text.indexOf(COMFY_JOB_MARKER_PREFIX);
  if (start === -1) {
    return { cleanText: text, marker: null as ComfyJobMarker | null };
  }

  const end = text.indexOf(COMFY_JOB_MARKER_SUFFIX, start);
  if (end === -1) {
    return { cleanText: text, marker: null as ComfyJobMarker | null };
  }

  const rawMarker = text.slice(
    start + COMFY_JOB_MARKER_PREFIX.length,
    end,
  ).trim();

  try {
    const marker = parseNestedMarker(rawMarker);
    if (!marker) {
      throw new Error("Invalid JSON marker shape");
    }
    const cleanText = `${text.slice(0, start)}${text.slice(
      end + COMFY_JOB_MARKER_SUFFIX.length,
    )}`.trim();

    return { cleanText, marker };
  } catch {
    const bareJobId = rawMarker.replace(/^"+|"+$/g, "").trim();
    if (!bareJobId) {
      return { cleanText: text, marker: null as ComfyJobMarker | null };
    }

    const cleanText = `${text.slice(0, start)}${text.slice(
      end + COMFY_JOB_MARKER_SUFFIX.length,
    )}`.trim();

    return {
      cleanText,
      marker: {
        jobId: bareJobId,
        status: "queued",
        workflowName: "quick_chroma",
      } satisfies ComfyJobMarker,
    };
  }
};
