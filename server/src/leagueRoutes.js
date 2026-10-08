import { Router } from "express";
import { z } from "zod";
import database from "./db.js";

const router = Router();
const querySchema = z.object({
  period: z.enum(["today", "week", "all"]).default("all"),
  collegeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

router.get("/colleges", (_request, response) => {
  response.json({
    colleges: database.prepare(`
      SELECT id, name
      FROM colleges
      ORDER BY name COLLATE NOCASE
    `).all()
  });
});

router.get("/", (request, response) => {
  const { period, collegeId, limit } = querySchema.parse(request.query);
  const dateFilter = period === "today"
    ? "AND ls.played_at >= datetime('now', 'start of day')"
    : period === "week"
      ? "AND ls.played_at >= datetime('now', '-7 days')"
      : "";
  const collegeFilter = collegeId ? "AND ls.college_id = @collegeId" : "";
  const parameters = { collegeId: collegeId ?? null, limit };

  const players = database.prepare(`
    SELECT
      ls.player_name AS name,
      COALESCE(c.name, 'Independent') AS college,
      SUM(ls.points) AS points,
      SUM(ls.correct_answers) AS correct_answers,
      SUM(ls.total_answers) AS total_answers,
      ROUND(CASE WHEN SUM(ls.total_answers) = 0 THEN 0
        ELSE 100.0 * SUM(ls.correct_answers) / SUM(ls.total_answers) END, 1) AS accuracy,
      ROUND(CASE WHEN SUM(ls.total_answers) = 0 THEN 0
        ELSE 1.0 * SUM(ls.average_answer_time_ms * ls.total_answers) / SUM(ls.total_answers) END) AS average_answer_time_ms,
      COUNT(*) AS games_played
    FROM league_scores ls
    LEFT JOIN colleges c ON c.id = ls.college_id
    WHERE 1 = 1 ${dateFilter} ${collegeFilter}
    GROUP BY ls.player_name, ls.college_id
    ORDER BY points DESC, accuracy DESC, average_answer_time_ms ASC, name COLLATE NOCASE
    LIMIT @limit
  `).all(parameters);

  const colleges = database.prepare(`
    SELECT
      COALESCE(c.name, 'Independent') AS name,
      SUM(ls.points) AS points,
      COUNT(DISTINCT ls.player_id) AS players,
      COUNT(DISTINCT ls.room_id) AS games_played,
      ROUND(CASE WHEN SUM(ls.total_answers) = 0 THEN 0
        ELSE 100.0 * SUM(ls.correct_answers) / SUM(ls.total_answers) END, 1) AS accuracy
    FROM league_scores ls
    LEFT JOIN colleges c ON c.id = ls.college_id
    WHERE 1 = 1 ${dateFilter} ${collegeFilter}
    GROUP BY ls.college_id
    ORDER BY points DESC, accuracy DESC, name COLLATE NOCASE
    LIMIT @limit
  `).all(parameters);

  response.json({ period, collegeId: collegeId ?? null, players, colleges });
});

export function leagueValidationErrorHandler(error, _request, response, next) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: "Invalid league filters.", details: error.issues });
  }
  return next(error);
}

export default router;
