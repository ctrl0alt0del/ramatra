type CritiqueMarkerPayload = {
  comfyTaskId: string;
  imageIndex: number;
};

const CRITIQUE_MARKER_REGEX =
  /^\s*\[\[critique_request\]\]\s*([\s\S]*?)\s*\[\[\/critique_request\]\]\s*$/i;

export const createCritiqueRequestMarker = (payload: CritiqueMarkerPayload) => {
  const sanitized: CritiqueMarkerPayload = {
    comfyTaskId: String(payload.comfyTaskId ?? "").trim(),
    imageIndex: Number.isFinite(payload.imageIndex)
      ? Math.max(0, Math.floor(payload.imageIndex))
      : 0,
  };

  return `[[critique_request]]${JSON.stringify(sanitized)}[[/critique_request]]`;
};

export const parseCritiqueRequestMarker = (
  text: string,
): CritiqueMarkerPayload | null => {
  const match = CRITIQUE_MARKER_REGEX.exec(text);
  if (!match) {
    return null;
  }

  const rawPayload = match[1]?.trim();
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<CritiqueMarkerPayload>;
    const comfyTaskId = String(parsed.comfyTaskId ?? "").trim();
    const imageIndex = Number(parsed.imageIndex);

    if (!comfyTaskId || !Number.isFinite(imageIndex) || imageIndex < 0) {
      return null;
    }

    return {
      comfyTaskId,
      imageIndex: Math.floor(imageIndex),
    };
  } catch {
    return null;
  }
};
