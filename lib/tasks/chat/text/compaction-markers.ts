import { formatContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";

export const applyCompactionMarkersToText = (
  text: string,
  breakOffsets: number[],
) => {
  if (!text || breakOffsets.length === 0) {
    return text;
  }

  const validBreakOffsets = Array.from(
    new Set(
      breakOffsets.filter((offset) => offset > 0 && offset < text.length),
    ),
  ).sort((left, right) => left - right);

  if (!validBreakOffsets.length) {
    return text;
  }

  let combinedText = text;
  for (let index = validBreakOffsets.length - 1; index >= 0; index -= 1) {
    const breakOffset = validBreakOffsets[index];
    const marker = formatContextCompactionDuringRequestMarker(index + 1);
    combinedText =
      combinedText.slice(0, breakOffset) +
      marker +
      combinedText.slice(breakOffset);
  }

  return combinedText;
};
