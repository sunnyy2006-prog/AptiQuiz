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
