export const ensureSentence = (value: string) => {
  const trimmed = value.trim().replace(/^[*-]\s+/, "");
  if (!trimmed) {
    return "";
  }
  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
};

const splitSentences = (text: string) => {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

export const getFirstSentence = (text: string) => {
  const [first] = splitSentences(text);
  return first ?? text.trim();
};

const tokenizeForOverlap = (text: string) => {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "your",
    "user",
    "intent",
    "image",
    "generation",
    "style",
    "make",
    "want",
    "wants",
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopwords.has(token)),
  );
};

export const getTokenOverlapRatio = (a: string, b: string) => {
  const left = tokenizeForOverlap(a);
  const right = tokenizeForOverlap(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let common = 0;
  for (const token of left) {
    if (right.has(token)) {
      common += 1;
    }
  }
  return common / Math.max(left.size, right.size);
};
