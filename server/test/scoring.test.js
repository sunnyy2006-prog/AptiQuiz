import test from "node:test";
import assert from "node:assert/strict";
import { calculateScore } from "../src/scoring.js";

test("returns zero for an incorrect answer", () => {
  assert.equal(calculateScore({ isCorrect: false, timeLeftMs: 15000, timeLimitMs: 15000 }), 0);
});

test("awards the maximum score when answered immediately", () => {
  assert.equal(calculateScore({ isCorrect: true, timeLeftMs: 15000, timeLimitMs: 15000 }), 1000);
});

test("awards the minimum correct score at the deadline", () => {
  assert.equal(calculateScore({ isCorrect: true, timeLeftMs: 0, timeLimitMs: 15000 }), 500);
});

test("calculates a proportional score in the middle of the round", () => {
  assert.equal(calculateScore({ isCorrect: true, timeLeftMs: 7500, timeLimitMs: 15000 }), 750);
});

test("clamps time left to the configured limit", () => {
  assert.equal(calculateScore({ isCorrect: true, timeLeftMs: 20000, timeLimitMs: 15000 }), 1000);
  assert.equal(calculateScore({ isCorrect: true, timeLeftMs: -1, timeLimitMs: 15000 }), 500);
});

test("rejects a non-positive time limit", () => {
  assert.throws(
    () => calculateScore({ isCorrect: true, timeLeftMs: 100, timeLimitMs: 0 }),
    /timeLimitMs must be a positive number/
  );
});
