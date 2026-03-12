export const COMFY_JOB_MARKER_PREFIX = "[[COMFY_JOB:";
export const COMFY_JOB_MARKER_SUFFIX = "]]";

export type ComfyJobMarker = {
  taskId: string;
  jobId?: string | null;
  status: "queued" | "running";
  workflowName: string;
};

const unwrapNestedValue = (value: unknown): unknown => {
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof current !== "string") {
      return current;
    }

    const trimmed = current.trim();
    if (!trimmed) {
      return null;
    }

    try {
      current = JSON.parse(trimmed);
      continue;
    } catch {
      return trimmed;
    }
  }

  return current;
};

const extractNestedId = (
  value: unknown,
  preferredKey: "taskId" | "jobId",
): string | null => {
  let current = unwrapNestedValue(value);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      return trimmed ? trimmed : null;
    }

    if (!current || typeof current !== "object") {
      return null;
    }

    const record = current as Record<string, unknown>;
    current =
      record[preferredKey] ??
      record.taskId ??
      record.jobId ??
      null;
    current = unwrapNestedValue(current);
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
};

const normalizeMarker = (marker: Record<string, unknown>): ComfyJobMarker | null => {
  const taskId = extractNestedId(marker.taskId, "taskId");
  const jobId =
    marker.jobId === undefined || marker.jobId === null
      ? null
      : extractNestedId(marker.jobId, "jobId");
  const status = marker.status;
  const workflowName =
    typeof marker.workflowName === "string" ? marker.workflowName.trim() : null;

  if (!taskId) {
    return null;
  }

  if (status !== "queued" && status !== "running") {
    return null;
  }

  if (!workflowName) {
    return null;
  }

  return {
    taskId,
    jobId,
    status,
    workflowName,
  };
};

const parseNestedMarker = (rawMarker: string): ComfyJobMarker | null => {
  let current: unknown = rawMarker;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current && typeof current === "object") {
      const normalized = normalizeMarker(current as Record<string, unknown>);
      if (normalized) {
        return normalized;
      }
    }

    if (typeof current !== "string") {
      return null;
    }

    const trimmed = current.trim();
    const candidates = trimmed.includes('\\"')
      ? [trimmed, trimmed.replace(/\\"/g, '"')]
      : [trimmed];

    let parsed = false;
    try {
      current = JSON.parse(candidates[0]);
      parsed = true;
    } catch {
      if (candidates.length > 1) {
        try {
          current = JSON.parse(candidates[1]);
          parsed = true;
        } catch {
          parsed = false;
        }
      }
    }

    if (!parsed) {
      return null;
    }
  }

  if (current && typeof current === "object") {
    return normalizeMarker(current as Record<string, unknown>);
  }

  return null;
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
  const cleanText = `${text.slice(0, start)}${text.slice(
    end + COMFY_JOB_MARKER_SUFFIX.length,
  )}`.trim();

  const candidates = [
    rawMarker,
    rawMarker.replace(/^"+|"+$/g, "").trim(),
  ];

  for (const candidate of candidates) {
    const marker = parseNestedMarker(candidate);
    if (marker) {
      return { cleanText, marker };
    }
  }

  return { cleanText: text, marker: null as ComfyJobMarker | null };
};
