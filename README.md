# AptiQuiz

A real-time multiplayer aptitude quiz for up to 50 players.

## Stack

- **Server:** Node.js, Express, Socket.IO, and SQLite via `better-sqlite3`
- **Client:** React, Vite, and Tailwind CSS

## Project structure

```text
.
├── client/       # React/Vite frontend
├── server/       # Express/Socket.IO backend
├── .env.example
└── package.json  # Workspace and development scripts
```

## Getting started

```bash
npm install
npm run dev
```

The client is available at `http://localhost:5173` and the API at
`http://localhost:3001`. The Vite development server proxies `/api` and
Socket.IO traffic to the server.

Copy `.env.example` to `.env` to customize local configuration. Never commit
`.env` or other secrets.

## Production

```bash
npm run build
npm start
```

The server serves the built client from `client/dist`, so the resulting
deployment can run as a single Node.js service.

## Multiplayer game events

The Socket.IO server is authoritative for room state, option shuffling,
deadlines, answers, scoring, and leaderboard transitions. Clients can use:

- `room:create` with `{ playerName, questionSetId?, collegeId? }`
- `room:join` with `{ code, playerName }`
- `game:start` (host only)
- `game:answer` with `{ optionIndex }`

The server emits `room:state`, `question:start`, `question:reveal`,
`game:answer-result`, and `game:leaderboard`. Game states progress through
`lobby`, `question`, `reveal`, `leaderboard`, and `finished`.

On `room:create` or `room:join`, the server returns a `sessionToken`. The
client stores it in `localStorage` and sends it on subsequent joins. A
reconnecting player keeps their score and player identity; if a question is
active, the server sends the player-specific shuffled options and
`remainingMs`. New players cannot join after the game starts, duplicate names
are rejected, and finished rooms are closed to all joins. Session tokens are
kept out of room state, leaderboard, and question payloads.

Socket events use strict Zod payload validation and per-socket rate limits.
Only the host session can start or skip an active question. Answer submissions
are checked against the active socket/session, current shuffled option mapping,
deadline, and duplicate-answer state. Correct answers are included only in
`question:reveal`, never in `question:start` or room state events.

## College league

Rooms can be associated with a college when created. Completed games write one
league score entry per player. The REST league API supports:

- `GET /api/league?period=today|week|all&collegeId=<id>&limit=<n>`
- `GET /api/league/colleges`

The client exposes the same filters from **View league**, with player and
college standings for today, this week, or all time.
