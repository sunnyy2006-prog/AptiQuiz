import test from "node:test";
import assert from "node:assert/strict";
import { eventSchemas, SocketRateLimiter } from "../src/socketValidation.js";

test("strictly validates answer payloads", () => {
  assert.equal(eventSchemas["game:answer"].safeParse({ optionIndex: 2 }).success, true);
  assert.equal(eventSchemas["game:answer"].safeParse({ optionIndex: 2, correctIndex: 0 }).success, false);
  assert.equal(eventSchemas["game:answer"].safeParse({ optionIndex: 8 }).success, false);
});

test("requires a session token or player name when joining", () => {
  assert.equal(eventSchemas["room:join"].safeParse({ code: "ABCDE" }).success, false);
  assert.equal(eventSchemas["room:join"].safeParse({ code: "ABCDE", playerName: "Ada" }).success, true);
  assert.equal(eventSchemas["room:join"].safeParse({ code: "ABCDE", sessionToken: "a".repeat(32) }).success, true);
});

test("limits events within the configured window", () => {
  const limiter = new SocketRateLimiter({ windowMs: 1000, maxEvents: 2 });
  assert.equal(limiter.allow(1000), true);
  assert.equal(limiter.allow(1001), true);
  assert.equal(limiter.allow(1002), false);
  assert.equal(limiter.allow(2001), true);
});
