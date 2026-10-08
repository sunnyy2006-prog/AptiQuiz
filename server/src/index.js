import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import database from "./db.js";
import questionSetRoutes, { validationErrorHandler } from "./routes.js";
import { registerGameSockets } from "./socketGame.js";
import leagueRoutes, { leagueValidationErrorHandler } from "./leagueRoutes.js";

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

app.use("/api/question-sets", questionSetRoutes);
app.use("/api/league", leagueRoutes);
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
