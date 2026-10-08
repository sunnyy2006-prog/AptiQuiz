import { GameRoom, GAME_STATES } from "./gameEngine.js";
import { randomBytes } from "node:crypto";
import { createEventHandler, SocketRateLimiter } from "./socketValidation.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function registerGameSockets(io, database, options = {}) {
  const rooms = new Map();
  const timeLimitMs = options.timeLimitMs ?? (Number(process.env.QUESTION_TIME_LIMIT_MS) || 15000);
  const revealDurationMs = options.revealDurationMs ?? (Number(process.env.REVEAL_DURATION_MS) || 3000);
  const leaderboardDurationMs = options.leaderboardDurationMs ?? (Number(process.env.LEADERBOARD_DURATION_MS) || 3000);

  io.on("connection", (socket) => {
    const limiter = new SocketRateLimiter({ windowMs: 1000, maxEvents: 30 });
    const answerLimiter = new SocketRateLimiter({ windowMs: 1000, maxEvents: 10 });

    socket.on("room:create", createEventHandler(socket, "room:create", (payload) => {
        if (socket.data.roomCode) throw new Error("Leave your current room before creating another.");
        const name = normalizeName(payload.playerName);
        const questions = loadQuestions(database, payload.questionSetId);
        const code = createRoomCode(rooms);
        const sessionToken = createSessionToken();
        const collegeId = ensureCollege(database, payload.collegeId, payload.collegeName);
        const room = new GameRoom({
          code,
          hostId: sessionToken,
          hostName: name,
          questions,
          options: { timeLimitMs, revealDurationMs, leaderboardDurationMs }
        });
        room.collegeId = collegeId;
        room.onStateChange = (currentRoom) => {
          if (currentRoom.state === GAME_STATES.FINISHED) {
            persistLeagueScores(database, currentRoom);
            setRoomStatus(database, currentRoom.code, "completed");
          }
          broadcastRoom(io, currentRoom);
        };
        rooms.set(code, room);
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.playerId = sessionToken;
        persistRoom(database, room, collegeId, payload.questionSetId);
        persistPlayer(database, room, sessionToken, socket.id);
        socket.emit("room:created", { code, sessionToken, isHost: true });
        broadcastRoom(io, room);
    }, limiter));

    socket.on("room:join", createEventHandler(socket, "room:join", (payload) => {
        const code = payload.code;
        const room = rooms.get(code);
        if (!room) throw new Error("Room not found.");
        if (socket.data.roomCode && socket.data.roomCode !== code) {
          throw new Error("Leave your current room before joining another.");
        }
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
        socket.emit("room:joined", { code, sessionToken: playerId, isHost: room.hostId === playerId, reconnected: isReconnect });
        if (isReconnect) {
          const players = getLeaderboard(room);
          sendRoomState(io, socket, room, players);
          sendPlayerView(io, socket, room, playerId, players);
        } else {
          broadcastRoom(io, room);
        }
    }, limiter));

    socket.on("game:start", createEventHandler(socket, "game:start", () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return socket.emit("room:error", { message: "Join a room first." });
      room.start(socket.data.playerId);
      setRoomStatus(database, room.code, "active");
    }, limiter));

    socket.on("game:skip", createEventHandler(socket, "game:skip", () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return socket.emit("room:error", { message: "Join a room first." });
      room.skip(socket.data.playerId);
    }, limiter));

    socket.on("host:results", createEventHandler(socket, "host:results", () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      if (room.hostId !== socket.data.playerId) throw new Error("Only the host can view results.");
      if (room.state !== GAME_STATES.FINISHED) throw new Error("Results are available after the game finishes.");
      socket.emit("host:results", buildHostResults(database, room));
    }, limiter));

    socket.on("game:answer", createEventHandler(socket, "game:answer", ({ optionIndex }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return socket.emit("game:answer-result", { accepted: false, reason: "Join a room first." });
      const player = room.players.get(socket.data.playerId);
      if (!player || !player.connected || player.socketId !== socket.id) {
        return socket.emit("game:answer-result", { accepted: false, reason: "You are not an active player in this room." });
      }
      const result = room.answer(socket.data.playerId, optionIndex);
      socket.emit("game:answer-result", result);
      if (result.accepted) persistAnswer(database, room, socket.data.playerId);
    }, answerLimiter));

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
    topic: question.topic,
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

function ensureCollege(database, collegeId, collegeName) {
  if (collegeId) {
    const college = database.prepare("SELECT id FROM colleges WHERE id = ?").get(Number(collegeId));
    if (!college) throw new Error("College not found.");
    return college.id;
  }
  if (!collegeName) return null;
  database.prepare("INSERT OR IGNORE INTO colleges (name) VALUES (?)").run(collegeName);
  return database.prepare("SELECT id FROM colleges WHERE name = ?").get(collegeName).id;
}

function persistLeagueScores(database, room) {
  if (room.leagueScoresPersisted) return;
  const dbRoom = database.prepare("SELECT id FROM rooms WHERE code = ?").get(room.code);
  if (!dbRoom) return;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO league_scores
      (room_id, player_id, college_id, player_name, points, correct_answers, total_answers,
       average_answer_time_ms, played_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  database.transaction(() => {
    for (const player of room.players.values()) {
      const dbPlayer = database.prepare("SELECT id FROM players WHERE room_id = ? AND name = ?").get(dbRoom.id, player.name);
      if (!dbPlayer) continue;
      const average = player.totalAnswers ? Math.round(player.totalAnswerTimeMs / player.totalAnswers) : 0;
      insert.run(dbRoom.id, dbPlayer.id, room.collegeId ?? null, player.name, player.score, player.correctAnswers, player.totalAnswers, average);
    }
  })();
  room.leagueScoresPersisted = true;
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

function buildHostResults(database, room) {
  const dbRoom = database.prepare("SELECT id FROM rooms WHERE code = ?").get(room.code);
  const questions = room.questions.map((question, index) => {
    const answers = database.prepare(`
      SELECT COUNT(*) AS answer_count,
        COALESCE(SUM(is_correct), 0) AS correct_count
      FROM answers a
      JOIN players p ON p.id = a.player_id
      WHERE p.room_id = ? AND a.question_id = ?
    `).get(dbRoom.id, question.id);
    const playerCount = database.prepare("SELECT COUNT(*) AS count FROM players WHERE room_id = ?").get(dbRoom.id).count;
    const missedCount = Math.max(0, playerCount - answers.answer_count);
    return {
      questionNumber: index + 1,
      questionId: question.id,
      text: question.text,
      topic: question.topic,
      correctCount: answers.correct_count,
      answerCount: answers.answer_count,
      missedCount,
      percentageCorrect: playerCount ? Math.round((answers.correct_count / playerCount) * 100) : 0
    };
  });
  const topics = database.prepare(`
    SELECT q.topic,
      COUNT(DISTINCT q.id) AS question_count,
      COUNT(a.id) AS answer_count,
      COALESCE(SUM(a.is_correct), 0) AS correct_count
    FROM questions q
    LEFT JOIN answers a ON a.question_id = q.id
    LEFT JOIN players p ON p.id = a.player_id AND p.room_id = ?
    WHERE q.id IN (${room.questions.map(() => "?").join(",")})
      AND (a.id IS NULL OR p.room_id = ?)
    GROUP BY q.topic
    ORDER BY q.topic COLLATE NOCASE
  `).all(dbRoom.id, ...room.questions.map((question) => question.id), dbRoom.id)
    .map((topic) => ({
      topic: topic.topic,
      correctCount: topic.correct_count,
      answerCount: topic.answer_count,
      accuracy: playerCount && topic.question_count
        ? Math.round((topic.correct_count / (playerCount * topic.question_count)) * 100)
        : 0
    }));
  const players = database.prepare(`
    SELECT p.name, q.text AS question, q.topic, q.correct_index AS correctIndex,
      a.selected_index AS selectedIndex,
      a.is_correct AS isCorrect, a.answered_at AS answeredAt
    FROM players p
    CROSS JOIN questions q
    LEFT JOIN answers a ON a.player_id = p.id AND a.question_id = q.id
    WHERE p.room_id = ? AND q.id IN (${room.questions.map(() => "?").join(",")})
    ORDER BY p.name COLLATE NOCASE, q.id
  `).all(dbRoom.id, ...room.questions.map((question) => question.id))
    .map((row) => ({ ...row, isCorrect: Boolean(row.isCorrect) }));
  return {
    roomCode: room.code,
    completedAt: new Date().toISOString(),
    questions,
    topics,
    players,
    mostMissed: [...questions].sort((left, right) => right.missedCount - left.missedCount).slice(0, 5)
  };
}

function broadcastRoom(io, room) {
  const players = getLeaderboard(room);
  sendRoomState(io, null, room, players);
  if (room.state === GAME_STATES.QUESTION) {
    for (const [playerId] of room.players) sendPlayerView(io, null, room, playerId);
  } else if (room.state === GAME_STATES.REVEAL) {
    for (const [playerId] of room.players) sendPlayerView(io, null, room, playerId, players);
  } else if (room.state === GAME_STATES.LEADERBOARD || room.state === GAME_STATES.FINISHED) {
    io.to(room.code).emit("game:leaderboard", { leaderboard: players, state: room.state });
  }
}

function sendRoomState(io, socket, room, players = getLeaderboard(room)) {
  const target = socket || io.to(room.code);
  target.emit("room:state", {
    code: room.code,
    state: room.state,
    hostName: room.players.get(room.hostId)?.name,
    players: players.map(({ name, score, connected }) => ({ name, score, connected })),
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
    if (player.questionEmittedAt === null) room.markQuestionEmitted(playerId);
    target.emit("question:start", {
      questionId: room.currentQuestion.id,
      text: room.currentQuestion.text,
      topic: room.currentQuestion.topic,
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
      topic: room.currentQuestion.topic,
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
    target.emit("game:leaderboard", { leaderboard: players, state: room.state });
  }
}

function getLeaderboard(room) {
  const sorted = [...room.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((player, index) => {
    const rank = index + 1;
    const change = player.previousRank === null ? "new" : rank < player.previousRank ? "climbed" : rank > player.previousRank ? "dropped" : "same";
    player.previousRank = rank;
    return { name: player.name, score: player.score, rank, rankChange: change, connected: player.connected };
  });
}
