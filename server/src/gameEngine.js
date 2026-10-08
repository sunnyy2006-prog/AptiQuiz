import { calculateScore } from "./scoring.js";

export const GAME_STATES = Object.freeze({
  LOBBY: "lobby",
  QUESTION: "question",
  REVEAL: "reveal",
  LEADERBOARD: "leaderboard",
  FINISHED: "finished"
});

const DEFAULTS = Object.freeze({
  timeLimitMs: 15000,
  revealDurationMs: 3000,
  leaderboardDurationMs: 3000
});

export class GameRoom {
  constructor({ code, hostId, hostName, questions, options = {}, now = () => Date.now(), scheduler = globalThis }) {
    if (!questions.length) throw new Error("A room requires at least one question.");
    this.code = code;
    this.hostId = hostId;
    this.questions = questions;
    this.options = { ...DEFAULTS, ...options };
    this.now = now;
    this.scheduler = scheduler;
    this.state = GAME_STATES.LOBBY;
    this.players = new Map([[hostId, createPlayer(hostId, hostName)]]);
    this.questionIndex = -1;
    this.currentQuestion = null;
    this.roundStartedAt = null;
    this.timer = null;
    this.onStateChange = null;
  }

  addPlayer(id, name) {
    if (this.state !== GAME_STATES.LOBBY) throw new Error("This game has already started.");
    if (this.players.size >= 50) throw new Error("This room is full.");
    if ([...this.players.values()].some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That player name is already in use.");
    }
    this.players.set(id, createPlayer(id, name));
  }

  disconnectPlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    if (this.state === GAME_STATES.QUESTION && this.allPlayersAnswered()) {
      this.endQuestion();
    }
  }

  reconnectPlayer(id, socketId) {
    if (this.state === GAME_STATES.FINISHED) throw new Error("This room is closed.");
    const player = this.players.get(id);
    if (!player) throw new Error("That session token is not valid for this room.");
    player.connected = true;
    player.socketId = socketId;
    return player;
  }

  start(requesterId) {
    if (requesterId !== this.hostId) throw new Error("Only the host can start the game.");
    if (this.state !== GAME_STATES.LOBBY) throw new Error("The game has already started.");
    this.questionIndex = 0;
    this.startQuestion();
  }

  skip(requesterId) {
    if (requesterId !== this.hostId) throw new Error("Only the host can skip a question.");
    if (this.state !== GAME_STATES.QUESTION) throw new Error("There is no active question to skip.");
    this.endQuestion();
  }

  answer(playerId, shuffledIndex) {
    if (this.state !== GAME_STATES.QUESTION || !this.currentQuestion) {
      return { accepted: false, reason: "The question is not active." };
    }
    const player = this.players.get(playerId);
    if (!player || !player.connected) return { accepted: false, reason: "You are not an active player in this room." };
    if (player.answer) return { accepted: false, reason: "An answer has already been submitted." };
    if (!Number.isInteger(shuffledIndex) || shuffledIndex < 0 || shuffledIndex >= this.currentQuestion.options.length) {
      return { accepted: false, reason: "Invalid option." };
    }

    const answeredAt = this.now();
    if (answeredAt >= this.roundStartedAt + this.options.timeLimitMs) {
      return { accepted: false, reason: "The question deadline has passed." };
    }

    const originalIndex = this.currentQuestion.mappings.get(playerId)[shuffledIndex];
    const isCorrect = originalIndex === this.currentQuestion.correctIndex;
    const emittedAt = player.questionEmittedAt ?? this.roundStartedAt;
    const timeLeftMs = Math.max(0, emittedAt + this.options.timeLimitMs - answeredAt);
    const points = calculateScore({ isCorrect, timeLeftMs, timeLimitMs: this.options.timeLimitMs });
    player.answer = { shuffledIndex, originalIndex, isCorrect, points, answeredAt, answerTimeMs: answeredAt - emittedAt };
    player.score += points;

    if (this.allPlayersAnswered()) this.endQuestion();
    return { accepted: true, isCorrect, points, answerTimeMs: answeredAt - emittedAt };
  }

  startQuestion() {
    this.clearTimer();
    const question = this.questions[this.questionIndex];
    const mappings = new Map();
    for (const playerId of this.players.keys()) {
      const mapping = shuffleIndices(question.options.length);
      mappings.set(playerId, mapping);
    }
    this.currentQuestion = { ...question, mappings };
    this.roundStartedAt = this.now();
    for (const player of this.players.values()) {
      player.answer = null;
      player.questionEmittedAt = null;
    }
    this.state = GAME_STATES.QUESTION;
    this.emitState();
    this.timer = this.scheduler.setTimeout(() => this.endQuestion(), this.options.timeLimitMs);
  }

  markQuestionEmitted(playerId) {
    const player = this.players.get(playerId);
    if (this.state === GAME_STATES.QUESTION && player) {
      player.questionEmittedAt = this.now();
    }
  }

  endQuestion() {
    if (this.state !== GAME_STATES.QUESTION) return;
    this.clearTimer();
    this.state = GAME_STATES.REVEAL;
    this.emitState();
    this.timer = this.scheduler.setTimeout(() => this.showLeaderboard(), this.options.revealDurationMs);
  }

  showLeaderboard() {
    if (this.state !== GAME_STATES.REVEAL) return;
    this.state = GAME_STATES.LEADERBOARD;
    this.emitState();
    this.timer = this.scheduler.setTimeout(() => {
      if (this.questionIndex + 1 >= this.questions.length) {
        this.state = GAME_STATES.FINISHED;
        this.emitState();
      } else {
        this.questionIndex += 1;
        this.startQuestion();
      }
    }, this.options.leaderboardDurationMs);
  }

  clearTimer() {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  allPlayersAnswered() {
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected);
    return connectedPlayers.length > 0 && connectedPlayers.every((player) => player.answer);
  }

  emitState() {
    this.onStateChange?.(this);
  }
}

export function createPlayer(id, name) {
  return {
    id,
    name,
    score: 0,
    answer: null,
    previousRank: null,
    questionEmittedAt: null,
    connected: true,
    socketId: null
  };
}

export function shuffleIndices(length) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}
