import { io } from "socket.io-client";

const PLAYER_COUNT = 50;
const RECONNECT_COUNT = 5;
const url = getOption("--url") || process.env.LOADTEST_URL || "http://localhost:3001";
const answerWindowMs = Number(getOption("--answer-window-ms") || 5000);
const reconnectDelayMs = Number(getOption("--reconnect-delay-ms") || 400);
const timeoutMs = Number(getOption("--timeout-ms") || 1800000);

const metrics = {
  joinAttempts: 0,
  joinSuccesses: 0,
  errors: [],
  answerAcks: [],
  rejectedAnswers: 0
};

const players = [];
let roomCode;
let finalLeaderboard;

function getOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function randomBetween(minimum, maximum) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function recordError(player, message) {
  metrics.errors.push(`${player.name}: ${message}`);
}

function waitFor(socket, event, timeout = timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

function createPlayer(index) {
  const player = {
    name: index === 0 ? "LoadTest Host" : `LoadTest Player ${index}`,
    socket: null,
    token: null,
    joined: false,
    hasReconnected: false,
    questionNumber: 0,
    pendingAnswer: null
  };
  player.socket = makeSocket(player);
  return player;
}

function makeSocket(player) {
  const socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    autoConnect: false
  });
  socket.on("room:error", ({ message }) => recordError(player, message));
  socket.on("connect_error", (error) => recordError(player, error.message));
  socket.on("question:start", (question) => onQuestion(player, question));
  socket.on("game:leaderboard", ({ leaderboard, state }) => {
    if (state === "finished") finalLeaderboard = leaderboard;
  });
  return socket;
}

async function join(player, isHost) {
  player.socket.connect();
  if (!player.socket.connected) await waitFor(player.socket, "connect");
  metrics.joinAttempts += 1;
  const event = isHost ? "room:create" : "room:join";
  const payload = isHost
    ? { playerName: player.name }
    : { code: roomCode, playerName: player.name };
  const joinedEvent = isHost ? "room:created" : "room:joined";
  player.socket.emit(event, payload);
  const response = await waitFor(player.socket, joinedEvent);
  player.token = response.sessionToken;
  player.joined = true;
  metrics.joinSuccesses += 1;
  if (isHost) roomCode = response.code;
}

function onQuestion(player, question) {
  player.questionNumber = question.questionNumber;
  if (player.pendingAnswer) clearTimeout(player.pendingAnswer);
  if (player.questionNumber === 1 && player.name !== "LoadTest Host" && Number(player.name.match(/\d+$/)?.[0]) <= RECONNECT_COUNT && !player.hasReconnected) {
    player.hasReconnected = true;
    player.socket.disconnect();
    setTimeout(() => reconnectPlayer(player), reconnectDelayMs);
    return;
  }
  scheduleAnswer(player, question);
}

function scheduleAnswer(player, question) {
  const delay = randomBetween(50, Math.max(50, Math.min(answerWindowMs, question.remainingMs - 100)));
  player.pendingAnswer = setTimeout(() => {
    if (!player.socket.connected) return;
    const startedAt = performance.now();
    player.socket.once("game:answer-result", (result) => {
      metrics.answerAcks.push(performance.now() - startedAt);
      if (!result.accepted) metrics.rejectedAnswers += 1;
    });
    // A random shuffled option produces random correctness without exposing the answer.
    player.socket.emit("game:answer", { optionIndex: randomBetween(0, question.options.length - 1) });
  }, delay);
}

function reconnectPlayer(player) {
  player.socket = makeSocket(player);
  player.socket.once("connect", () => {
    player.socket.emit("room:join", {
      code: roomCode,
      playerName: player.name,
      sessionToken: player.token
    });
  });
  player.socket.once("room:joined", () => {
    player.joined = true;
  });
  player.socket.connect();
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
}

function printReport() {
  const joinRate = metrics.joinAttempts ? (metrics.joinSuccesses / metrics.joinAttempts) * 100 : 0;
  const average = metrics.answerAcks.length
    ? metrics.answerAcks.reduce((sum, latency) => sum + latency, 0) / metrics.answerAcks.length
    : 0;
  const leaderboardConsistent = isLeaderboardConsistent(finalLeaderboard);
  console.log("\nAptiQuiz load test");
  console.log(`URL: ${url}`);
  console.log(`Players: ${PLAYER_COUNT}`);
  console.log(`Join success rate: ${joinRate.toFixed(1)}% (${metrics.joinSuccesses}/${metrics.joinAttempts})`);
  console.log(`Answer acknowledgements: ${metrics.answerAcks.length} (rejected: ${metrics.rejectedAnswers})`);
  console.log(`Answer-ack latency: average ${average.toFixed(1)} ms, p95 ${percentile(metrics.answerAcks, 95).toFixed(1)} ms`);
  console.log(`Errors: ${metrics.errors.length}`);
  for (const error of metrics.errors.slice(0, 10)) console.log(`  - ${error}`);
  console.log(`Final leaderboard consistent: ${leaderboardConsistent ? "YES" : "NO"}`);
  if (finalLeaderboard) console.log(`Final leaderboard entries: ${finalLeaderboard.length}`);
}

function isLeaderboardConsistent(leaderboard) {
  if (!Array.isArray(leaderboard) || leaderboard.length !== PLAYER_COUNT) return false;
  const names = new Set(leaderboard.map((player) => player.name));
  if (names.size !== PLAYER_COUNT) return false;
  return leaderboard.every((player, index) =>
    player.rank === index + 1 &&
    Number.isFinite(player.score) &&
    (index === 0 || leaderboard[index - 1].score >= player.score)
  );
}

async function main() {
  console.log(`Connecting ${PLAYER_COUNT} players to ${url}...`);
  for (let index = 0; index < PLAYER_COUNT; index += 1) players.push(createPlayer(index));
  try {
    await join(players[0], true);
    await Promise.all(players.slice(1).map((player) => join(player, false)));
    console.log(`Room ${roomCode}: all players joined. Starting game...`);
    players[0].socket.emit("game:start");
    await waitForFinished();
    printReport();
    if (metrics.joinSuccesses !== PLAYER_COUNT || !isLeaderboardConsistent(finalLeaderboard)) process.exitCode = 1;
  } catch (error) {
    metrics.errors.push(error.message);
    printReport();
    process.exitCode = 1;
  } finally {
    for (const player of players) {
      if (player.pendingAnswer) clearTimeout(player.pendingAnswer);
      player.socket?.disconnect();
    }
  }
}

function waitForFinished() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for the final leaderboard.")), timeoutMs);
    const check = () => {
      if (finalLeaderboard) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

main();
