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
    SELECT p.id, p.name, COALESCE(c.name, 'Independent') AS college
    FROM players p
    JOIN rooms r ON r.id = p.room_id
    LEFT JOIN colleges c ON c.id = r.college_id
    WHERE p.session_token = ?
    ORDER BY p.id DESC
    LIMIT 1
  `).get(sessionToken);
  if (!player) return response.status(404).json({ error: "Profile not found." });
  const stats = database.prepare(`
    SELECT COUNT(*) AS total_games, COALESCE(SUM(points), 0) AS points,
      COALESCE(SUM(correct_answers), 0) AS correct_answers,
      COALESCE(SUM(total_answers), 0) AS total_answers
    FROM league_scores WHERE player_id = ?
  `).get(player.id);
  const bestTopic = database.prepare(`
    SELECT q.topic, SUM(a.is_correct) * 1.0 / COUNT(a.id) AS accuracy
    FROM answers a JOIN questions q ON q.id = a.question_id
    JOIN players p ON p.id = a.player_id
    WHERE p.session_token = ?
    GROUP BY q.topic ORDER BY accuracy DESC, q.topic COLLATE NOCASE LIMIT 1
  `).get(sessionToken);
  const badges = database.prepare("SELECT badges FROM league_scores WHERE player_id = ?").all(player.id)
    .flatMap((row) => JSON.parse(row.badges || "[]"));
  response.json({
    name: player.name,
    college: player.college,
    totalGames: stats.total_games,
    accuracy: stats.total_answers ? Math.round((stats.correct_answers / stats.total_answers) * 100) : 0,
    bestTopic: bestTopic?.topic || null,
    badges: [...new Set(badges)]
  });
});

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
