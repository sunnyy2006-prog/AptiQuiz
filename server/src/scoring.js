export function calculateScore({ isCorrect, timeLeftMs, timeLimitMs }) {
  if (!isCorrect) return 0;
  if (!Number.isFinite(timeLeftMs) || !Number.isFinite(timeLimitMs) || timeLimitMs <= 0) {
    throw new RangeError("timeLimitMs must be a positive number.");
  }

  const clampedTimeLeft = Math.max(0, Math.min(timeLeftMs, timeLimitMs));
  return Math.round(1000 * (0.5 + 0.5 * clampedTimeLeft / timeLimitMs));
}
