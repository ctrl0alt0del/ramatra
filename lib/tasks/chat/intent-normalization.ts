import {
  collectJsonStringLeaves,
  tryParseJsonLikeText,
} from "@/lib/tasks/chat/intent-normalization-json";
import {
  ensureSentence,
  getFirstSentence,
  getTokenOverlapRatio,
} from "@/lib/tasks/chat/intent-normalization-text";

export const normalizeIntentToNaturalLanguage = (raw: string) => {
  const parsed = tryParseJsonLikeText(raw);
  if (!parsed) {
    return raw.trim();
  }

  const uniqueLeaves = [
    ...new Set(collectJsonStringLeaves(parsed).map((item) => item.trim())),
  ].filter((item) => item.length > 0);
  if (!uniqueLeaves.length) {
    return raw.trim();
  }

  return uniqueLeaves
    .map((item) => ensureSentence(item))
    .filter(Boolean)
    .join(" ");
};

export const balanceIntentWithPrevious = ({
  previousIntent,
  nextIntent,
}: {
  previousIntent: string;
  nextIntent: string;
}) => {
  const previous = previousIntent.trim();
  const next = nextIntent.trim();

  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }

  const overlapRatio = getTokenOverlapRatio(previous, next);
  if (overlapRatio >= 0.4) {
    return next;
  }

  const priorSentence = ensureSentence(getFirstSentence(previous));
  const latestSentence = ensureSentence(getFirstSentence(next));

  const blended = [priorSentence, latestSentence].filter(Boolean).join(" ");
  return blended || next;
};
