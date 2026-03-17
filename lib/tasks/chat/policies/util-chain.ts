export const MAX_UTIL_COMMAND_DEPTH = 3;
export const MAX_UTIL_COMMAND_ENQUEUES = 3;

export const evaluateUtilChainContinuation = ({
  commandDepth,
  utilEnqueueCount,
  commandNonce,
  knownNonces,
}: {
  commandDepth: number;
  utilEnqueueCount: number;
  commandNonce: string;
  knownNonces: string[];
}):
  | { allowed: true }
  | { allowed: false; reason: "depth-limit" | "enqueue-limit" | "duplicate-nonce" } => {
  if (commandDepth >= MAX_UTIL_COMMAND_DEPTH) {
    return { allowed: false, reason: "depth-limit" };
  }
  if (utilEnqueueCount >= MAX_UTIL_COMMAND_ENQUEUES) {
    return { allowed: false, reason: "enqueue-limit" };
  }
  if (commandNonce && knownNonces.includes(commandNonce)) {
    return { allowed: false, reason: "duplicate-nonce" };
  }

  return { allowed: true };
};
