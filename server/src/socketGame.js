import { GameRoom, GAME_STATES } from "./gameEngine.js";
import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function registerGameSockets(io, database, options = {}) {
  const rooms = new Map();
  const timeLimitMs = options.timeLimitMs ?? (Number(process.env.QUESTION_TIME_LIMIT_MS) || 15000);
  const revealDurationMs = options.revealDurationMs ?? (Number(process.env.REVEAL_DURATION_MS) || 3000);
  const leaderboardDurationMs = options.leaderboardDurationMs ?? (Number(process.env.LEADERBOARD_DURATION_MS) || 3000);

  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}) => {
      try {
        const name = normalizeName(payload.playerName);
        const questions = loadQuestions(database, payload.questionSetId);
        const code = createRoomCode(rooms);
        const sessionToken = createSessionToken();
        const room = new GameRoom({
          code,
          hostId: sessionToken,
          hostName: name,
          questions,
          options: { timeLimitMs, revealDurationMs, leaderboardDurationMs }
        });
        room.onStateChange = (currentRoom) => {
          if (currentRoom.state === GAME_STATES.FINISHED) {
            setRoomStatus(database, currentRoom.code, "completed");
          }
          broadcastRoom(io, currentRoom);
        };
        rooms.set(code, room);
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.playerId = sessionToken;
        persistRoom(database, room, payload.collegeId, payload.questionSetId);
        persistPlayer(database, room, sessionToken, socket.id);
        socket.emit("room:created", { code, sessionToken, playerId: sessionToken, isHost: true });
        broadcastRoom(io, room);
      } catch (error) {
        socket.emit("room:error", { message: error.message });
      }
    });

    socket.on("room:join", (payload = {}) => {
      try {
        const code = String(payload.code ?? payload.roomId ?? "").trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) throw new Error("Room not found.");
        const sessionToken = String(payload.sessionToken || "").trim();
        let playerId = sessionToken;
        let isReconnect = false;
        if (sessionToken && room.players.has(sessionToken)) {
          const previousSocketId = room.players.get(sessionToken).socketId;
          const previousSocket = previousSocketId ? io.sockets.sockets.get(previousSocketId) : null;
          if (previousSocket && previousSocket.id !== socket.id) {
            previousSocket.data.roomCode = null;
            previousSocket.data.playerId = null;
            previousSocket.disconnect(true);
          }
          room.reconnectPlayer(sessionToken, socket.id);
          playerId = sessionToken;
          isReconnect = true;
        } else {
          if (sessionToken) throw new Error("That session token is not valid for this room.");
          if (room.state !== GAME_STATES.LOBBY) throw new Error("This game has already started.");
          const name = normalizeName(payload.playerName);
          playerId = createSessionToken();
          room.addPlayer(playerId, name);
        }
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.playerId = playerId;
        persistPlayer(database, room, playerId, socket.id);
        socket.emit("room:joined", { code, sessionToken: playerId, playerId, isHost: room.hostId === playerId, reconnected: isReconnect });
        if (isReconnect) {
          sendRoomState(io, socket, room);
          sendPlayerView(io, socket, room, playerId);
        } else {
          broadcastRoom(io, room);
        }
      } catch (error) {
        socket.emit("room:error", { message: error.message });
      }
    });

    socket.on("game:start", () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return socket.emit("room:error", { message: "Join a room first." });
      try {
        room.start(socket.data.playerId);
        setRoomStatus(database, room.code, "active");
      } catch (error) {
        socket.emit("room:error", { message: error.message });
      }
    });

    socket.on("game:answer", ({ optionIndex } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return socket.emit("game:answer-result", { accepted: false, reason: "Join a room first." });
      const result = room.answer(socket.data.playerId, optionIndex);
      socket.emit("game:answer-result", result);
      if (result.accepted) persistAnswer(database, room, socket.data.playerId);
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      const room = rooms.get(code);
      if (!room) return;
      room.disconnectPlayer(socket.data.playerId);
      broadcastRoom(io, room);
    });
  });

  return rooms;
}

function normalizeName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 40) throw new Error("Player name must be between 1 and 40 characters.");
  return name;
}

function loadQuestions(database, questionSetId) {
  const query = questionSetId
    ? database.prepare("SELECT * FROM questions WHERE question_set_id = ? ORDER BY order_index, id").all(Number(questionSetId))
    : database.prepare("SELECT * FROM questions ORDER BY question_set_id, order_index, id").all();
  if (!query.length) throw new Error("No questions are available for this game.");
  return query.map((question) => ({
    id: question.id,
    text: question.text,
    options: JSON.parse(question.options),
    correctIndex: question.correct_index,
    imageUrl: question.image_url,
    tableJson: question.table_json === null ? null : JSON.parse(question.table_json)
  }));
}

function createRoomCode(rooms) {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function createSessionToken() {
  return randomBytes(24).toString("base64url");
}

function persistRoom(database, room, collegeId, questionSetId) {
  database.prepare(`
    INSERT INTO rooms (code, college_id, question_set_id, status)
    VALUES (?, ?, ?, 'waiting')
  `).run(room.code, collegeId ? Number(collegeId) : null, questionSetId ? Number(questionSetId) : null);
}

function persistPlayer(database, room, playerId, socketId) {
  const dbRoom = database.prepare("SELECT id FROM rooms WHERE code = ?").get(room.code);
  const player = room.players.get(playerId);
  if (!dbRoom || !player) return;
  player.socketId = socketId;
  player.connected = true;
  database.prepare(`
    INSERT OR IGNORE INTO players (room_id, name, socket_id)
    VALUES (?, ?, ?)
  `).run(dbRoom.id, player.name, socketId);
  database.prepare("UPDATE players SET socket_id = ? WHERE room_id = ? AND name = ?").run(socketId, dbRoom.id, player.name);
}

function setRoomStatus(database, code, status) {
  database.prepare("UPDATE rooms SET status = ? WHERE code = ?").run(status, code);
}

function persistAnswer(database, room, playerId) {
  const player = room.players.get(playerId);
  const question = room.currentQuestion;
  if (!player?.answer || !question) return;
  const dbPlayer = database.prepare("SELECT id FROM players WHERE socket_id = ? AND room_id = (SELECT id FROM rooms WHERE code = ?)").get(player.socketId, room.code);
  if (!dbPlayer) return;
  database.prepare(`
    INSERT OR IGNORE INTO answers (player_id, question_id, selected_index, is_correct)
    VALUES (?, ?, ?, ?)
  `).run(dbPlayer.id, question.id, player.answer.originalIndex, player.answer.isCorrect ? 1 : 0);
}

function broadcastRoom(io, room) {
  sendRoomState(io, null, room);
  const players = getLeaderboard(room);
  if (room.state === GAME_STATES.QUESTION) {
    for (const [playerId] of room.players) sendPlayerView(io, null, room, playerId);
  } else if (room.state === GAME_STATES.REVEAL) {
    for (const [playerId] of room.players) sendPlayerView(io, null, room, playerId, players);
  } else if (room.state === GAME_STATES.LEADERBOARD || room.state === GAME_STATES.FINISHED) {
    io.to(room.code).emit("game:leaderboard", { leaderboard: players });
  }
}

function sendRoomState(io, socket, room) {
  const target = socket || io.to(room.code);
  const players = getLeaderboard(room);
  target.emit("room:state", {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    players: players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    questionNumber: room.questionIndex + 1,
    totalQuestions: room.questions.length
  });
}

function sendPlayerView(io, socket, room, playerId, players = getLeaderboard(room)) {
  const player = room.players.get(playerId);
  if (!player || (!socket && !player.connected)) return;
  const target = socket || io.to(player.socketId);
  if (room.state === GAME_STATES.QUESTION) {
    const mapping = room.currentQuestion.mappings.get(playerId);
    room.markQuestionEmitted(playerId);
    target.emit("question:start", {
        questionId: room.currentQuestion.id,
        text: room.currentQuestion.text,
        options: mapping.map((index) => room.currentQuestion.options[index]),
        imageUrl: room.currentQuestion.imageUrl,
        tableJson: room.currentQuestion.tableJson,
        timeLimitMs: room.options.timeLimitMs,
        remainingMs: Math.max(0, room.roundStartedAt + room.options.timeLimitMs - room.now()),
        questionNumber: room.questionIndex + 1,
        totalQuestions: room.questions.length
    });
  } else if (room.state === GAME_STATES.REVEAL) {
    const mapping = room.currentQuestion.mappings.get(playerId);
      const correctShuffledIndex = mapping.indexOf(room.currentQuestion.correctIndex);
    target.emit("question:reveal", {
        questionId: room.currentQuestion.id,
        text: room.currentQuestion.text,
        options: mapping.map((index) => room.currentQuestion.options[index]),
        correctIndex: room.currentQuestion.correctIndex,
        correctOption: room.currentQuestion.options[room.currentQuestion.correctIndex],
        correctShuffledIndex,
        answer: player.answer ? {
          selectedIndex: player.answer.shuffledIndex,
          isCorrect: player.answer.isCorrect,
          points: player.answer.points
        } : null,
        leaderboard: players
    });
  } else if (room.state === GAME_STATES.LEADERBOARD || room.state === GAME_STATES.FINISHED) {
    target.emit("game:leaderboard", { leaderboard: players });
  }
}

function getLeaderboard(room) {
  const sorted = [...room.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((player, index) => {
    const rank = index + 1;
    const change = player.previousRank === null ? "new" : rank < player.previousRank ? "climbed" : rank > player.previousRank ? "dropped" : "same";
    player.previousRank = rank;
    return { id: player.id, name: player.name, score: player.score, rank, rankChange: change, connected: player.connected };
  });
}
