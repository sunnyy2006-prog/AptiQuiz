import "dotenv/config";
import express from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import database from "./db.js";
import questionSetRoutes, { validationErrorHandler } from "./routes.js";
import { registerGameSockets } from "./socketGame.js";
import leagueRoutes, { leagueValidationErrorHandler } from "./leagueRoutes.js";
import practiceRoutes from "./practiceRoutes.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDirectory, "../../client/dist");

app.use(express.json());
app.use("/api/question-sets", express.text({ type: ["text/csv", "application/csv"], limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  try {
    database.prepare("SELECT 1").get();
    response.json({ status: "ok", service: "aptiquiz-server" });
  } catch {
    response.status(503).json({ status: "error", service: "aptiquiz-server" });
  }
});

app.get("/api/questions", (_request, response) => {
  const questions = database
    .prepare("SELECT * FROM questions ORDER BY question_set_id, order_index, id")
    .all()
    .map((question) => ({
      ...question,
      options: JSON.parse(question.options),
      table_json: question.table_json === null ? null : JSON.parse(question.table_json)
    }));
  response.json({ questions });
});

app.get("/api/profile/:sessionToken", (request, response) => {
  const sessionToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/).parse(request.params.sessionToken);
  const player = database.prepare(`
    SELECT p.id, p.name, r.college_id AS college_id, COALESCE(c.name, 'Independent') AS college
    FROM players p
    JOIN rooms r ON r.id = p.room_id
    LEFT JOIN colleges c ON c.id = r.college_id
    WHERE p.session_token = ?
    ORDER BY p.id DESC
    LIMIT 1
  `).get(sessionToken);
  if (!player) return response.status(404).json({ error: "Profile not found." });
  const identity = { name: player.name, collegeId: player.college_id ?? null };
  const stats = database.prepare(`
    SELECT COUNT(*) AS total_games, COALESCE(SUM(points), 0) AS points,
      COALESCE(SUM(correct_answers), 0) AS correct_answers,
      COALESCE(SUM(total_answers), 0) AS total_answers,
      ROUND(SUM(average_answer_time_ms * total_answers) * 1.0 / NULLIF(SUM(total_answers), 0)) AS average_answer_time_ms
    FROM league_scores WHERE player_name = @name AND college_id IS @collegeId
  `).get(identity);
  const globalStanding = database.prepare(`
    WITH totals AS (
      SELECT player_name AS name, college_id, SUM(points) AS points
      FROM league_scores GROUP BY player_name, college_id
    )
    SELECT
      (SELECT COUNT(*) FROM totals) AS total_players,
      (SELECT points FROM totals WHERE name = @name AND college_id IS @collegeId) AS points,
      (SELECT COUNT(*) FROM totals AS t WHERE t.points > (SELECT points FROM totals WHERE name = @name AND college_id IS @collegeId)) + 1 AS global_rank
  `).get(identity);
  const collegeStanding = database.prepare(`
    WITH totals AS (
      SELECT player_name AS name, SUM(points) AS points
      FROM league_scores WHERE college_id IS @collegeId GROUP BY player_name
    )
    SELECT
      (SELECT COUNT(*) FROM totals) AS college_players,
      (SELECT COUNT(*) FROM totals AS t WHERE t.points > (SELECT points FROM totals WHERE name = @name)) + 1 AS college_rank
  `).get(identity);
  const topics = database.prepare(`
    SELECT q.topic AS topic, COUNT(a.id) AS total,
      ROUND(100.0 * SUM(a.is_correct) / COUNT(a.id), 1) AS accuracy
    FROM answers a JOIN questions q ON q.id = a.question_id
    JOIN players p ON p.id = a.player_id
    WHERE p.session_token = ?
    GROUP BY q.topic ORDER BY accuracy DESC, q.topic COLLATE NOCASE
  `).all(sessionToken);
  const badges = database.prepare("SELECT badges FROM league_scores WHERE player_id = ?").all(player.id)
    .flatMap((row) => JSON.parse(row.badges || "[]"));
  const ranked = globalStanding?.points != null;
  const totalPlayers = globalStanding?.total_players || 0;
  const globalRank = ranked ? globalStanding.global_rank : null;
  response.json({
    name: player.name,
    college: player.college,
    totalGames: stats.total_games,
    points: stats.points,
    accuracy: stats.total_answers ? Math.round((stats.correct_answers / stats.total_answers) * 100) : 0,
    averageTime: stats.average_answer_time_ms ? Math.round(stats.average_answer_time_ms / 1000) : 0,
    globalRank,
    totalPlayers,
    collegeRank: collegeStanding?.college_rank ?? null,
    collegePlayers: collegeStanding?.college_players ?? 0,
    tier: tierFor(globalRank, totalPlayers),
    bestTopic: topics[0]?.topic || null,
    topics,
    badges: [...new Set(badges)]
  });
});

function tierFor(rank, total) {
  if (!rank || !total) return "Rookie";
  if (rank === 1) return "Champion";
  const percentile = rank / total;
  if (percentile <= 0.1) return "Gold";
  if (percentile <= 0.25) return "Silver";
  if (percentile <= 0.5) return "Bronze";
  return "Rookie";
}

app.use("/api/question-sets", questionSetRoutes);
app.use("/api/league", leagueRoutes);
app.use("/api/practice", practiceRoutes);
app.use(leagueValidationErrorHandler);
app.use(validationErrorHandler);

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });
}

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

registerGameSockets(io, database);

httpServer.listen(port, () => {
  console.log(`AptiQuiz server listening on port ${port}`);
});
