import { z } from "zod";

const emptyPayload = z.object({}).strict();
const playerName = z.string().trim().min(1).max(40);
const sessionToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/, "Invalid session token.");

export const eventSchemas = Object.freeze({
  "room:create": z.object({
    playerName,
    questionSetId: z.coerce.number().int().positive().optional(),
    collegeId: z.coerce.number().int().positive().optional()
  }).strict(),
  "room:join": z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5}$/, "Room code must be 5 characters."),
    playerName: playerName.optional(),
    sessionToken: sessionToken.optional()
  }).strict().superRefine((payload, context) => {
    if (!payload.playerName && !payload.sessionToken) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["playerName"], message: "Player name is required for a new join." });
    }
  }),
  "game:start": emptyPayload,
  "game:skip": emptyPayload,
  "game:answer": z.object({
    optionIndex: z.number().int().min(0).max(7)
  }).strict()
});

export class SocketRateLimiter {
  constructor({ windowMs = 1000, maxEvents = 30 } = {}) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.events = [];
  }

  allow(now = Date.now()) {
    this.events = this.events.filter((timestamp) => timestamp > now - this.windowMs);
    if (this.events.length >= this.maxEvents) return false;
    this.events.push(now);
    return true;
  }
}

export function createEventHandler(socket, eventName, handler, limiter) {
  const schema = eventSchemas[eventName];
  return (payload = {}) => {
    if (!limiter.allow()) {
      socket.emit("room:error", { message: "Too many requests. Please slow down." });
      return;
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      socket.emit("room:error", { message: "Invalid event payload.", details: result.error.issues });
      return;
    }
    try {
      handler(result.data);
    } catch (error) {
      socket.emit("room:error", { message: error instanceof Error ? error.message : "Request rejected." });
    }
  };
}
