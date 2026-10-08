import { calculateScore } from "./scoring.js";

export const GAME_STATES = Object.freeze({
  LOBBY: "lobby",
  QUESTION: "question",
  REVEAL: "reveal",
  LEADERBOARD: "leaderboard",
  FINISHED: "finished"
  ,PAUSED: "paused"
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
    this.questionDeadline = null;
    this.pausedRemainingMs = null;
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

  pause(requesterId) {
    if (requesterId !== this.hostId) throw new Error("Only the host can pause the game.");
    if (this.state !== GAME_STATES.QUESTION) throw new Error("Only an active question can be paused.");
    this.pausedRemainingMs = Math.max(0, this.questionDeadline - this.now());
    this.clearTimer();
    this.state = GAME_STATES.PAUSED;
    this.emitState();
  }

  resume(requesterId) {
    if (requesterId !== this.hostId) throw new Error("Only the host can resume the game.");
    if (this.state !== GAME_STATES.PAUSED) throw new Error("The question is not paused.");
    this.questionDeadline = this.now() + this.pausedRemainingMs;
    this.state = GAME_STATES.QUESTION;
    this.emitState();
    this.timer = this.scheduler.setTimeout(() => this.endQuestion(), this.pausedRemainingMs);
    this.pausedRemainingMs = null;
  }

  addTime(requesterId, seconds) {
    if (requesterId !== this.hostId) throw new Error("Only the host can change the timer.");
    if (this.state !== GAME_STATES.QUESTION && this.state !== GAME_STATES.PAUSED) throw new Error("There is no active question.");
    const extensionMs = seconds * 1000;
    if (this.state === GAME_STATES.PAUSED) this.pausedRemainingMs += extensionMs;
    else {
      this.questionDeadline += extensionMs;
      this.clearTimer();
      this.timer = this.scheduler.setTimeout(() => this.endQuestion(), Math.max(0, this.questionDeadline - this.now()));
    }
    this.emitState();
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
    if (answeredAt >= this.questionDeadline) {
      return { accepted: false, reason: "The question deadline has passed." };
    }

    const originalIndex = this.currentQuestion.mappings.get(playerId)[shuffledIndex];
    const isCorrect = originalIndex === this.currentQuestion.correctIndex;
    const emittedAt = player.questionEmittedAt ?? this.roundStartedAt;
    const timeLeftMs = Math.max(0, emittedAt + this.options.timeLimitMs - answeredAt);
    const basePoints = calculateScore({ isCorrect, timeLeftMs, timeLimitMs: this.options.timeLimitMs });
    const doublePointsApplied = isCorrect && player.powerUps.doublePointsArmed;
    const streakBeforeAnswer = player.currentStreak;
    const streakBonus = isCorrect ? Math.min(5, streakBeforeAnswer + 1) * 0.1 : 0;
    const streakPoints = Math.round(basePoints * (1 + streakBonus));
    const points = doublePointsApplied ? streakPoints * 2 : streakPoints;
    if (doublePointsApplied) player.powerUps.doublePointsArmed = false;
    player.answer = { shuffledIndex, originalIndex, isCorrect, points, basePoints, streakBonus, doublePointsApplied, answeredAt, answerTimeMs: answeredAt - emittedAt };
    player.score += points;
    player.totalAnswers += 1;
    player.correctAnswers += isCorrect ? 1 : 0;
    player.currentStreak = isCorrect ? streakBeforeAnswer + 1 : 0;
    player.maxStreak = Math.max(player.maxStreak, player.currentStreak);
    player.totalAnswerTimeMs += answeredAt - emittedAt;

    if (this.allPlayersAnswered()) this.endQuestion();
    return { accepted: true, isCorrect, points, answerTimeMs: answeredAt - emittedAt };
  }

  usePowerUp(playerId, type) {
    if (this.state !== GAME_STATES.QUESTION || !this.currentQuestion) {
      return { accepted: false, reason: "Power-ups are only available during an active question." };
    }
    const player = this.players.get(playerId);
    if (!player || !player.connected) return { accepted: false, reason: "You are not an active player in this room." };
    if (!["doublePoints", "fiftyFifty"].includes(type)) return { accepted: false, reason: "Invalid power-up." };

    if (type === "doublePoints") {
      if (!player.powerUps.doublePointsAvailable) return { accepted: false, reason: "Double Points has already been used." };
      player.powerUps.doublePointsAvailable = false;
      player.powerUps.doublePointsArmed = true;
      return { accepted: true, type, powerUps: getPowerUpView(player) };
    }

    if (!player.powerUps.fiftyFiftyAvailable) return { accepted: false, reason: "50-50 has already been used." };
    if (this.currentQuestion.options.length < 3) return { accepted: false, reason: "50-50 is not available for this question." };
    const mapping = this.currentQuestion.mappings.get(playerId);
    const correctShuffledIndex = mapping.indexOf(this.currentQuestion.correctIndex);
    const wrongIndices = mapping
      .map((_, index) => index)
      .filter((index) => index !== correctShuffledIndex);
    const removedOptionIndices = shuffleIndices(wrongIndices.length)
      .slice(0, 2)
      .map((index) => wrongIndices[index])
      .sort((left, right) => left - right);
    player.powerUps.fiftyFiftyAvailable = false;
    player.powerUps.fiftyFiftyQuestionId = this.currentQuestion.id;
    player.powerUps.fiftyFiftyRemoved = removedOptionIndices;
    return { accepted: true, type, removedOptionIndices, powerUps: getPowerUpView(player) };
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
    this.questionDeadline = this.roundStartedAt + this.options.timeLimitMs;
    for (const player of this.players.values()) {
      player.answer = null;
      player.questionEmittedAt = null;
      player.powerUps.fiftyFiftyQuestionId = null;
      player.powerUps.fiftyFiftyRemoved = [];
    }
    this.state = GAME_STATES.QUESTION;
    this.emitState();
    this.timer = this.scheduler.setTimeout(() => this.endQuestion(), this.questionDeadline - this.now());
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
        for (const player of this.players.values()) player.badges = calculateBadges(player);
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
    socketId: null,
    totalAnswers: 0,
    correctAnswers: 0,
    totalAnswerTimeMs: 0,
    currentStreak: 0,
    maxStreak: 0,
    badges: [],
    powerUps: {
      doublePointsAvailable: true,
      doublePointsArmed: false,
      fiftyFiftyAvailable: true,
      fiftyFiftyQuestionId: null,
      fiftyFiftyRemoved: []
    }
  };
}

export function calculateBadges(player) {
  const badges = [];
  if (player.totalAnswers > 0 && player.correctAnswers === player.totalAnswers) badges.push("Perfect Round");
  if (player.maxStreak >= 10) badges.push("10-Streak");
  if (player.totalAnswers > 0 && player.totalAnswerTimeMs / player.totalAnswers <= 3000) badges.push("Speed Demon");
  return badges;
}

export function getPowerUpView(player) {
  return {
    doublePointsAvailable: player.powerUps.doublePointsAvailable,
    doublePointsArmed: player.powerUps.doublePointsArmed,
    fiftyFiftyAvailable: player.powerUps.fiftyFiftyAvailable
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
