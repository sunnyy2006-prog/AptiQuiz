import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import database from "./db.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3001;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDirectory, "../../client/dist");

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "aptiquiz-server" });
});

app.get("/api/questions", (_request, response) => {
  const questions = database
    .prepare("SELECT id, prompt, options FROM questions ORDER BY id")
    .all()
    .map((question) => ({ ...question, options: JSON.parse(question.options) }));
  response.json({ questions });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });
}

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, playerName } = {}) => {
    const normalizedRoomId = String(roomId || "").trim().toUpperCase();
    const normalizedPlayerName = String(playerName || "").trim();

    if (!normalizedRoomId || !normalizedPlayerName) {
      socket.emit("room:error", { message: "A room code and player name are required." });
      return;
    }

    const room = io.sockets.adapter.rooms.get(normalizedRoomId);
    if (room && room.size >= 50) {
      socket.emit("room:error", { message: "This room is full." });
      return;
    }

    socket.join(normalizedRoomId);
    socket.data.playerName = normalizedPlayerName;
    socket.data.roomId = normalizedRoomId;
    io.to(normalizedRoomId).emit("room:players", getPlayers(normalizedRoomId));
    socket.emit("room:joined", { roomId: normalizedRoomId, playerName: normalizedPlayerName });
  });

  socket.on("disconnect", () => {
    const { roomId } = socket.data;
    if (roomId) io.to(roomId).emit("room:players", getPlayers(roomId));
  });
});

function getPlayers(roomId) {
  const playerIds = io.sockets.adapter.rooms.get(roomId) || [];
  return [...playerIds].map((id) => ({
    id,
    name: io.sockets.sockets.get(id)?.data.playerName || "Player"
  }));
}

httpServer.listen(port, () => {
  console.log(`AptiQuiz server listening on port ${port}`);
});
