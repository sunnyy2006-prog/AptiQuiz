import { Router } from "express";
import { z } from "zod";
import database from "./db.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const optionalJsonSchema = z.union([z.record(z.unknown()), z.array(z.unknown())]).nullable().optional();
const questionSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
  correct_index: z.number().int().nonnegative(),
  topic: z.string().trim().min(1).max(100),
  difficulty: z.enum(["easy", "medium", "hard"]),
  image_url: z.string().url().nullable().optional(),
  table_json: optionalJsonSchema
}).superRefine((question, context) => {
  if (question.correct_index >= question.options.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correct_index"],
      message: "correct_index must point to an option"
    });
  }
});
const questionSetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(""),
  college_id: z.number().int().positive().nullable().optional()
});
const reorderSchema = z.object({
  questionIds: z.array(z.number().int().positive()).min(1)
});

function parseJson(value) {
  return value === null ? null : JSON.parse(value);
}

function serializeQuestion(question) {
  return {
    ...question,
    options: JSON.parse(question.options),
    table_json: parseJson(question.table_json)
  };
}

function getQuestionSet(id) {
  return database.prepare("SELECT * FROM question_sets WHERE id = ?").get(id);
}

router.get("/", (_request, response) => {
  const sets = database.prepare(`
    SELECT qs.*, COUNT(q.id) AS question_count
    FROM question_sets qs
    LEFT JOIN questions q ON q.question_set_id = qs.id
    GROUP BY qs.id
    ORDER BY qs.updated_at DESC, qs.id DESC
  `).all();
  response.json({ question_sets: sets });
});

router.get("/:id", (request, response, next) => {
  const id = idSchema.parse(request.params.id);
  const questionSet = getQuestionSet(id);
  if (!questionSet) return response.status(404).json({ error: "Question set not found." });
  const questions = database
    .prepare("SELECT * FROM questions WHERE question_set_id = ? ORDER BY order_index, id")
    .all(id)
    .map(serializeQuestion);
  response.json({ question_set: questionSet, questions });
});

router.post("/", (request, response) => {
  const input = questionSetSchema.parse(request.body);
  const result = database.prepare(`
    INSERT INTO question_sets (name, description, college_id)
    VALUES (@name, @description, @college_id)
  `).run({ ...input, college_id: input.college_id ?? null });
  response.status(201).json({ question_set: getQuestionSet(result.lastInsertRowid) });
});

router.patch("/:id", (request, response) => {
  const id = idSchema.parse(request.params.id);
  if (!getQuestionSet(id)) return response.status(404).json({ error: "Question set not found." });
  const input = questionSetSchema.partial().parse(request.body);
  if (Object.keys(input).length === 0) return response.status(400).json({ error: "At least one field is required." });
  const fields = Object.keys(input);
  const values = { id, ...input, college_id: input.college_id ?? null };
  database.prepare(`
    UPDATE question_sets
    SET ${fields.map((field) => `${field} = @${field}`).join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run(values);
  response.json({ question_set: getQuestionSet(id) });
});

router.delete("/:id", (request, response) => {
  const id = idSchema.parse(request.params.id);
  const result = database.prepare("DELETE FROM question_sets WHERE id = ?").run(id);
  if (result.changes === 0) return response.status(404).json({ error: "Question set not found." });
  response.status(204).send();
});

router.post("/:id/questions", (request, response) => {
  const questionSetId = idSchema.parse(request.params.id);
  if (!getQuestionSet(questionSetId)) return response.status(404).json({ error: "Question set not found." });
  const input = questionSchema.parse(request.body);
  const orderIndex = database.prepare("SELECT COALESCE(MAX(order_index) + 1, 0) AS next_order FROM questions WHERE question_set_id = ?").get(questionSetId).next_order;
  const result = database.prepare(`
    INSERT INTO questions
      (question_set_id, text, options, correct_index, topic, difficulty, image_url, table_json, order_index)
    VALUES
      (@question_set_id, @text, @options, @correct_index, @topic, @difficulty, @image_url, @table_json, @order_index)
  `).run({
    question_set_id: questionSetId,
    ...input,
    options: JSON.stringify(input.options),
    image_url: input.image_url ?? null,
    table_json: input.table_json === undefined ? null : JSON.stringify(input.table_json),
    order_index: orderIndex
  });
  response.status(201).json({
    question: serializeQuestion(database.prepare("SELECT * FROM questions WHERE id = ?").get(result.lastInsertRowid))
  });
});

router.patch("/questions/:questionId", (request, response) => {
  const questionId = idSchema.parse(request.params.questionId);
  const existing = database.prepare("SELECT * FROM questions WHERE id = ?").get(questionId);
  if (!existing) return response.status(404).json({ error: "Question not found." });
  const input = questionSchema.partial().parse(request.body);
  if (Object.keys(input).length === 0) return response.status(400).json({ error: "At least one field is required." });
  const merged = questionSchema.parse({
    text: existing.text,
    options: input.options ?? JSON.parse(existing.options),
    correct_index: input.correct_index ?? existing.correct_index,
    topic: input.topic ?? existing.topic,
    difficulty: input.difficulty ?? existing.difficulty,
    image_url: input.image_url === undefined ? existing.image_url : input.image_url,
    table_json: input.table_json === undefined ? parseJson(existing.table_json) : input.table_json
  });
  const fields = Object.keys(input);
  const values = {
    id: questionId,
    ...input,
    options: input.options ? JSON.stringify(merged.options) : undefined,
    image_url: input.image_url ?? null,
    table_json: input.table_json === undefined ? undefined : JSON.stringify(merged.table_json)
  };
  database.prepare(`
    UPDATE questions
    SET ${fields.map((field) => `${field} = @${field}`).join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run(values);
  response.json({
    question: serializeQuestion(database.prepare("SELECT * FROM questions WHERE id = ?").get(questionId))
  });
});

router.post("/:id/questions/reorder", (request, response) => {
  const questionSetId = idSchema.parse(request.params.id);
  if (!getQuestionSet(questionSetId)) return response.status(404).json({ error: "Question set not found." });
  const { questionIds } = reorderSchema.parse(request.body);
  const existingIds = database.prepare("SELECT id FROM questions WHERE question_set_id = ?").all(questionSetId).map((row) => row.id);
  if (existingIds.length !== questionIds.length || existingIds.some((id) => !questionIds.includes(id))) {
    return response.status(400).json({ error: "questionIds must contain every question in this set exactly once." });
  }
  const update = database.prepare("UPDATE questions SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND question_set_id = ?");
  database.transaction(() => questionIds.forEach((questionId, index) => update.run(index, questionId, questionSetId)))();
  response.json({ questions: database.prepare("SELECT * FROM questions WHERE question_set_id = ? ORDER BY order_index, id").all(questionSetId).map(serializeQuestion) });
});

router.delete("/questions/:questionId", (request, response) => {
  const questionId = idSchema.parse(request.params.questionId);
  const result = database.prepare("DELETE FROM questions WHERE id = ?").run(questionId);
  if (result.changes === 0) return response.status(404).json({ error: "Question not found." });
  response.status(204).send();
});

export function validationErrorHandler(error, _request, response, next) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "Validation failed.", details: error.issues });
  return next(error);
}

export default router;
