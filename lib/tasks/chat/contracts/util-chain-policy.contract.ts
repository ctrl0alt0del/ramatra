import assert from "node:assert/strict";
import {
  evaluateUtilChainContinuation,
  MAX_UTIL_COMMAND_DEPTH,
  MAX_UTIL_COMMAND_ENQUEUES,
} from "@/lib/tasks/chat/policies/util-chain";

const run = () => {
  const ok = evaluateUtilChainContinuation({
    commandDepth: 0,
    utilEnqueueCount: 0,
    commandNonce: "",
    knownNonces: [],
  });
  assert.equal(ok.allowed, true);

  const depthBlocked = evaluateUtilChainContinuation({
    commandDepth: MAX_UTIL_COMMAND_DEPTH,
    utilEnqueueCount: 0,
    commandNonce: "",
    knownNonces: [],
  });
  assert.equal(depthBlocked.allowed, false);
  if (!depthBlocked.allowed) {
    assert.equal(depthBlocked.reason, "depth-limit");
  }

  const enqueueBlocked = evaluateUtilChainContinuation({
    commandDepth: 0,
    utilEnqueueCount: MAX_UTIL_COMMAND_ENQUEUES,
    commandNonce: "",
    knownNonces: [],
  });
  assert.equal(enqueueBlocked.allowed, false);
  if (!enqueueBlocked.allowed) {
    assert.equal(enqueueBlocked.reason, "enqueue-limit");
  }

  const nonceBlocked = evaluateUtilChainContinuation({
    commandDepth: 0,
    utilEnqueueCount: 0,
    commandNonce: "abc",
    knownNonces: ["abc"],
  });
  assert.equal(nonceBlocked.allowed, false);
  if (!nonceBlocked.allowed) {
    assert.equal(nonceBlocked.reason, "duplicate-nonce");
  }
};

run();
console.log("util-chain-policy.contract: OK");
