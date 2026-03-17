const MAX_UTIL_NONCE_HISTORY = 24;

export const appendUtilCommandNonce = (
  existing: string[] | undefined,
  nonce: string | undefined,
) => {
  if (!nonce) {
    return existing ?? [];
  }

  const normalized = nonce.trim();
  if (!normalized) {
    return existing ?? [];
  }

  const next = [
    ...(existing ?? []).filter((value) => value !== normalized),
    normalized,
  ];

  if (next.length <= MAX_UTIL_NONCE_HISTORY) {
    return next;
  }

  return next.slice(next.length - MAX_UTIL_NONCE_HISTORY);
};
