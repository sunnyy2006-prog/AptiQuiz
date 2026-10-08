import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import database from "./db.js";
import { generateText } from "./ai/aiClient.js";

const router = Router();
const sessions = new Map();
const sessionTtlMs = 60 * 60 * 1000;
const categories = ["quantitative", "logical", "verbal", "data-interpretation"];
const lengths = [5, 10, 15];
const categoryLabels = {
  quantitative: "quantitative",
  logical: "logical",
  verbal: "verbal",
  "data-interpretation": "data interpretation"
};
const startSchema = z.object({
  category: z.enum(["quantitative", "logical", "verbal", "data-interpretation", "mixed"]),
  total: z.union([z.literal(5), z.literal(10), z.literal(15)])
});
const nextSchema = z.object({ sessionId: z.string().uuid() });
const answerSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().min(1).max(100),
  selectedIndex: z.number().int().min(0).max(3)
});
const finishSchema = z.object({ sessionId: z.string().uuid() });
const requestLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-7", legacyHeaders: false });

const builtInQuestions = [
  { text: "What is 20% of 150?", options: ["15", "20", "30", "45"], correctIndex: 2, explanation: ["Convert 20% to 0.2.", "Multiply 150 by 0.2.", "The result is 30."], topic: "quantitative" },
  { text: "If all Nors are Tals and all Tals are Veks, what must be true?", options: ["All Veks are Nors", "All Nors are Veks", "No Nors are Veks", "Some Tals are not Veks"], correctIndex: 1, explanation: ["Nors are contained in Tals.", "Tals are contained in Veks.", "Therefore Nors are contained in Veks."], topic: "logical" },
  { text: "Choose the closest meaning of 'brief'.", options: ["Short", "Heavy", "Bright", "Late"], correctIndex: 0, explanation: ["A synonym has a similar meaning.", "Brief means lasting a short time or using few words.", "So the best option is Short."], topic: "verbal" },
  { text: "Sales were 10, 20 and 30 units in three months. What was the average?", options: ["15", "20", "25", "30"], correctIndex: 1, explanation: ["Add the three values: 60.", "There are three months.", "Divide 60 by 3 to get 20."], topic: "data interpretation" }
];

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function getSession(sessionId) {
  cleanupSessions();
  const session = sessions.get(sessionId);
  if (!session || session.finished) return null;
  session.expiresAt = Date.now() + sessionTtlMs;
  return session;
}

function difficultyForLevel(level) {
  return level < 4 ? "easy" : level < 7 ? "medium" : "hard";
}

function timeLimitForLevel(level) {
  return Math.round(45 + ((level - 1) / 9) * 45);
}

function shuffleOptions(question) {
  const options = question.options.map((text, index) => ({ text, index }));
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = (question.seed + index * 17) % (index + 1);
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }
  return {
    options: options.map(({ text }) => text),
    correctIndex: options.findIndex(({ index }) => index === question.correctIndex)
  };
}

function dbFallback(category, level, used) {
  const topic = category === "mixed" ? null : categoryLabels[category];
  const difficulty = difficultyForLevel(level);
  const rows = database.prepare(`
    SELECT text, options, correct_index AS correctIndex, topic, explanation
    FROM questions
    WHERE (? IS NULL OR topic = ?)
    ORDER BY CASE difficulty WHEN ? THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
  `).all(topic, topic, difficulty);
  const candidates = rows.filter((row) => !used.has(row.text));
  const row = candidates[0] || rows[0];
  if (!row) return null;
  return {
    text: row.text,
    options: JSON.parse(row.options),
    correctIndex: row.correctIndex,
    explanation: row.explanation
      ? row.explanation.split(/\.\s+/).filter(Boolean).slice(0, 5)
      : ["Identify the relevant rule or relationship.", "Work through the values step by step.", "Check the result against the options."],
    topic: row.topic,
    aiGenerated: false
  };
}

function parseGeneratedQuestion(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const schema = z.object({
    text: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(500)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.array(z.string().trim().min(1).max(300)).min(3).max(5),
    topic: z.string().trim().min(1).max(100)
  });
  const question = schema.parse(parsed);
  if (new Set(question.options.map((option) => option.toLowerCase())).size !== 4) throw new Error("Options must be distinct.");
  return { ...question, aiGenerated: true };
}

async function generateQuestion(session) {
  const fallback = () => dbFallback(session.category, session.level, session.used) || {
    ...builtInQuestions[session.used.size % builtInQuestions.length],
    aiGenerated: false
  };
  if (!process.env.AI_API_KEY) return fallback();
  const user = `Create one aptitude question for category "${session.category}" at level ${session.level.toFixed(1)} on a 1-10 scale. Avoid these earlier question texts: ${JSON.stringify([...session.used])}. Return ONLY JSON with text, options (exactly 4 distinct strings), correctIndex (0-3), explanation (3 to 5 short steps), and topic.`;
  const system = "You write fair, self-contained aptitude practice questions. Do not mention personal data. Keep explanations concise.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await generateText({ system, user, maxTokens: 1000, json: true });
      if (!raw) return fallback();
      return parseGeneratedQuestion(raw);
    } catch {
      if (attempt === 1) return fallback();
    }
  }
  return fallback();
}

function publicQuestion(session, question) {
  const shuffled = shuffleOptions({ ...question, seed: session.number + session.level * 10 });
  const questionId = `${session.number}-${randomUUID()}`;
  session.current = {
    id: questionId,
    ...question,
    correctIndex: shuffled.correctIndex,
    options: shuffled.options,
    startedAt: Date.now(),
    timeLimit: timeLimitForLevel(session.level)
  };
  session.number += 1;
  session.used.add(question.text);
  return {
    questionId,
    text: question.text,
    options: shuffled.options,
    timeLimit: session.current.timeLimit,
    number: session.number,
    total: session.total,
    topic: question.topic,
    aiGenerated: question.aiGenerated
  };
}

async function prepareNext(session) {
  if (session.prefetch || session.number >= session.total) return;
  session.prefetch = generateQuestion(session).catch(() => dbFallback(session.category, session.level, session.used));
}

function getTips(summary) {
  const weakest = [...summary.topicStrengths].sort((a, b) => a.accuracy - b.accuracy)[0];
  const tips = [];
  tips.push(summary.accuracy < 70 ? "Review the core rules behind missed questions before increasing speed." : "Keep mixing timed questions with short accuracy-focused review.");
  tips.push(summary.averageTime > 45 ? "Use a quick plan first, then calculate; avoid spending too long on one step." : "Your pace is steady; use spare seconds to verify signs, units, and wording.");
  if (weakest) tips.push(`Practise a few extra ${weakest.topic} questions, starting with fundamentals.`);
  tips.push(summary.finalLevel >= 7 ? "Try harder mixed sets to turn strong performance into consistent results." : "Build confidence with easy and medium questions before moving to advanced sets.");
  return tips.slice(0, 4);
}

router.use(requestLimiter);

router.post("/start", (request, response) => {
  const input = startSchema.parse(request.body);
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    sessionId,
    category: input.category,
    total: input.total,
    level: 5,
    number: 0,
    used: new Set(),
    answers: [],
    current: null,
    prefetch: null,
    expiresAt: Date.now() + sessionTtlMs,
    finished: false
  });
  response.status(201).json({ sessionId, category: input.category, total: input.total, level: 5 });
});

router.post("/next", async (request, response) => {
  const input = nextSchema.parse(request.body);
  const session = getSession(input.sessionId);
  if (!session) return response.status(404).json({ error: "Practice session not found or already finished." });
  if (session.current) return response.status(409).json({ error: "Answer the current question before requesting the next one." });
  const question = session.prefetch ? await session.prefetch : await generateQuestion(session);
  session.prefetch = null;
  response.json(publicQuestion(session, question));
  void prepareNext(session);
});

router.post("/answer", (request, response) => {
  const input = answerSchema.parse(request.body);
  const session = getSession(input.sessionId);
  if (!session) return response.status(404).json({ error: "Practice session not found or already finished." });
  if (!session.current || session.current.id !== input.questionId) return response.status(409).json({ error: "That question is no longer active." });
  const current = session.current;
  const elapsedMs = Date.now() - current.startedAt;
  const timeTaken = Math.max(0, Math.round(elapsedMs / 1000));
  const correct = elapsedMs <= current.timeLimit * 1000 && input.selectedIndex === current.correctIndex;
  const previousLevel = session.level;
  const levelChange = correct ? (timeTaken <= current.timeLimit * 0.5 ? 0.6 : 0.3) : -0.5;
  session.level = Math.max(1, Math.min(10, Number((session.level + levelChange).toFixed(1))));
  session.answers.push({ topic: current.topic, correct, timeTaken });
  session.current = null;
  response.json({
    correct,
    correctIndex: current.correctIndex,
    explanation: current.explanation,
    timeTaken,
    newLevel: session.level,
    previousLevel,
    aiGenerated: current.aiGenerated
  });
});

router.post("/finish", async (request, response) => {
  const input = finishSchema.parse(request.body);
  const session = getSession(input.sessionId);
  if (!session) return response.status(404).json({ error: "Practice session not found or already finished." });
  if (session.current) return response.status(409).json({ error: "Answer the current question before finishing." });
  session.finished = true;
  const total = session.answers.length;
  const correct = session.answers.filter((answer) => answer.correct).length;
  const strengths = [...session.answers.reduce((map, answer) => {
    const item = map.get(answer.topic) || { topic: answer.topic, correct: 0, total: 0 };
    item.total += 1;
    item.correct += answer.correct ? 1 : 0;
    map.set(answer.topic, item);
    return map;
  }, new Map()).values()].map((item) => ({ topic: item.topic, accuracy: Math.round((item.correct / item.total) * 100) }));
  const summary = {
    finalLevel: session.level,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    averageTime: total ? Math.round(session.answers.reduce((sum, answer) => sum + answer.timeTaken, 0) / total) : 0,
    topicStrengths: strengths
  };
  let tips = getTips(summary);
  if (process.env.AI_API_KEY) {
    try {
      const raw = await generateText({
        system: "You provide concise study tips from quiz metrics only. Return ONLY a JSON array of 3 or 4 strings. Never mention personal data.",
        user: `Metrics: ${JSON.stringify(summary)}`,
        maxTokens: 500,
        json: true
      });
      const parsed = z.array(z.string().trim().min(1).max(300)).min(3).max(4).safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()));
      if (parsed.success) tips = parsed.data;
    } catch {
      // Deterministic tips keep practice available when the provider is unavailable.
    }
  }
  sessions.delete(input.sessionId);
  response.json({ ...summary, tips });
});

export default router;
