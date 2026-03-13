import { getTextFromMessageContent, type MessagePart } from "@/lib/chat/message-content";

const MARKER_PREFIX = "[[context_compaction_during_request:";
const MARKER_REGEX = /^\[\[context_compaction_during_request:(\d+)]]$/;
const MARKER_GLOBAL_REGEX = /\[\[context_compaction_during_request:(\d+)]]/g;

export const formatContextCompactionDuringRequestMarker = (count: number) => {
  const normalized = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return `${MARKER_PREFIX}${normalized}]]`;
};

export const parseContextCompactionDuringRequestMarker = (text: string) => {
  const match = text.trim().match(MARKER_REGEX);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

export const hasContextCompactionMarker = (text: string) => {
  MARKER_GLOBAL_REGEX.lastIndex = 0;
  return MARKER_GLOBAL_REGEX.test(text);
};

export const splitTextByContextCompactionMarkers = (text: string) => {
  const chunks: Array<{
    text: string;
    markerCountAfter: number | null;
  }> = [];
  let lastIndex = 0;
  MARKER_GLOBAL_REGEX.lastIndex = 0;

  let match = MARKER_GLOBAL_REGEX.exec(text);
  while (match) {
    const chunkText = text.slice(lastIndex, match.index);
    const markerCount = Number.parseInt(match[1], 10);

    chunks.push({
      text: chunkText,
      markerCountAfter:
        Number.isFinite(markerCount) && markerCount > 0 ? markerCount : 1,
    });

    lastIndex = match.index + match[0].length;
    match = MARKER_GLOBAL_REGEX.exec(text);
  }

  chunks.push({
    text: text.slice(lastIndex),
    markerCountAfter: null,
  });

  return chunks;
};

export const replaceContextCompactionMarkersForDisplay = (text: string) => {
  MARKER_GLOBAL_REGEX.lastIndex = 0;
  return text.replace(
    MARKER_GLOBAL_REGEX,
    (_match, countRaw: string) =>
      `\n\n---\n\nContext compacted during response (${countRaw})\n\n---\n\n`,
  );
};

export const parseContextCompactionMarkerFromMessageParts = (
  parts: MessagePart[],
) => {
  const text = getTextFromMessageContent(parts).trim();
  if (!text) {
    return null;
  }

  return parseContextCompactionDuringRequestMarker(text);
};

export const messagePartsContainContextCompactionMarker = (parts: MessagePart[]) => {
  const text = getTextFromMessageContent(parts);
  MARKER_GLOBAL_REGEX.lastIndex = 0;
  return MARKER_GLOBAL_REGEX.test(text);
};
