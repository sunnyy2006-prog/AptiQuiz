import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(serverRoot, "data", "aptiquiz.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");

const questionColumns = database
  .prepare("PRAGMA table_info(questions)")
  .all()
  .map((column) => column.name);
if (questionColumns.length > 0 && !questionColumns.includes("question_set_id")) {
  database.exec("ALTER TABLE questions RENAME TO questions_legacy");
}
if (questionColumns.length > 0 && !questionColumns.includes("explanation")) {
  database.exec("ALTER TABLE questions ADD COLUMN explanation TEXT");
}
const playerColumns = database.prepare("PRAGMA table_info(players)").all().map((column) => column.name);
if (playerColumns.length > 0 && !playerColumns.includes("session_token")) database.exec("ALTER TABLE players ADD COLUMN session_token TEXT");
const leagueColumns = database.prepare("PRAGMA table_info(league_scores)").all().map((column) => column.name);
if (leagueColumns.length > 0 && !leagueColumns.includes("badges")) database.exec("ALTER TABLE league_scores ADD COLUMN badges TEXT NOT NULL DEFAULT '[]'");

const leagueScoreColumns = database
  .prepare("PRAGMA table_info(league_scores)")
  .all()
  .map((column) => column.name);
if (leagueScoreColumns.length > 0 && !leagueScoreColumns.includes("room_id")) {
  database.exec("ALTER TABLE league_scores RENAME TO league_scores_legacy");
}

database.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS colleges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS question_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_set_id INTEGER NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options TEXT NOT NULL,
    correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    image_url TEXT,
    table_json TEXT,
    explanation TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
    question_set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    socket_id TEXT,
    session_token TEXT UNIQUE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_index INTEGER,
    is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
    answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS league_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_answers INTEGER NOT NULL DEFAULT 0,
    average_answer_time_ms INTEGER NOT NULL DEFAULT 0,
    played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    badges TEXT NOT NULL DEFAULT '[]',
    UNIQUE(room_id, player_id)
  );

  CREATE INDEX IF NOT EXISTS idx_questions_set_order
    ON questions(question_set_id, order_index);
  CREATE INDEX IF NOT EXISTS idx_players_room
    ON players(room_id);
  CREATE INDEX IF NOT EXISTS idx_league_scores_played_at
    ON league_scores(played_at);
  CREATE INDEX IF NOT EXISTS idx_league_scores_college
    ON league_scores(college_id);
`);

export default database;
