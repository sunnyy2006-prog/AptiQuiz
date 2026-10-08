# AptiQuiz

AptiQuiz is a real-time multiplayer aptitude quiz for up to 50 players in one
room. A host creates a room, players join with a short code, and the server
controls the timed questions, answers, scoring, reveals, and leaderboard.

## What it does

### Problem Statement 1: aptitude practice is often solitary

Many aptitude quizzes are static forms or individual practice sessions. AptiQuiz
turns the same kind of questions into a shared live activity with timed rounds,
instant reveals, and a changing leaderboard.

### Problem Statement 2: multiplayer timing should be trustworthy

If the browser decides when a question ends or how many points an answer gets,
players can see inconsistent results. AptiQuiz keeps room state, timers,
option shuffling, answer deadlines, score calculation, and game transitions on
the server.

### Problem Statement 3: game results are difficult to understand after a round

Players need a quick result, while hosts need more detail. AptiQuiz provides
player results with accuracy, speed, topic strengths, and a leaderboard. Hosts
also get per-question accuracy, most-missed questions, topic accuracy, and a
CSV export of player/question results.

## Done / Left / Plan

### Done

- Monorepo with React/Vite client and Node/Express/Socket.IO server.
- SQLite schema for colleges, question sets, questions, rooms, players,
  answers, and league scores.
- Zod-validated question-set and question REST APIs.
- Seed data containing 40 aptitude questions across quantitative, logical,
  verbal, and data interpretation topics.
- Server-authoritative game states: lobby, question, reveal, leaderboard, and
  finished.
- Five-character room codes and a 50-player room limit.
- Per-player option shuffling without sending correct answers before reveal.
- One-answer-per-player-per-question, deadline checks, server-side answer
  timing, and score calculation.
- Reconnection using a session token stored by the client in `localStorage`.
- Socket event validation, per-socket rate limits, host-only start/skip
  controls, and checks against stale or inactive sockets.
- Mobile-first client screens for home, lobby, question, reveal, leaderboard,
  final results, and the college league.
- QR room invitation, accessible labels and controls, responsive layouts, and
  colour-blind-safe status colours.
- College league standings for today, this week, and all time.
- Host results dashboard with CSV export.
- Render deployment configuration with a health endpoint and persistent SQLite
  disk instructions.
- A 50-player Socket.IO load-test script with reconnect simulation and
  leaderboard consistency checks.

### Left

- The repository does not contain a configured deployed/live URL.
- Runtime deployment verification depends on the Render service being created
  and its environment variables and disk being configured.
- SQLite and the in-memory room engine are designed for one service instance;
  multi-instance scaling would require shared storage and Socket.IO
  coordination.

### Plan

1. Deploy the single web service on Render using the instructions below.
2. Set the final Render URL in `CLIENT_ORIGIN` and verify `/api/health`.
3. Seed or create the desired question sets in the deployed database.
4. Run the load test against the deployed URL.
5. If multi-instance scaling is needed later, move persistence to a shared
   database and add a Socket.IO adapter/session strategy.

## Architecture and why

```text
React + Vite + Tailwind client
        │
        │ HTTP / Socket.IO
        ▼
Express + Socket.IO Node server
        │
        ├── In-memory authoritative GameRoom state
        └── SQLite via better-sqlite3
```

- **Client:** React renders the current screen and sends user actions. Vite
  provides local development and builds the client into `client/dist`.
- **Server:** Express serves REST APIs and the built client in production.
  Socket.IO handles real-time room events.
- **Game engine:** `GameRoom` owns the state machine, players, per-question
  mappings, timers, answers, scores, and transitions. The server is the source
  of truth.
- **SQLite:** `better-sqlite3` stores questions, rooms, players, answers,
  league records, and completed-game data.
- **Single deployment:** The server serves `client/dist`, so one Render web
  service can host both the browser app and the API/socket endpoint.

This design keeps live game timing simple and consistent for one process. It
also makes the deployment constraint explicit: the in-memory room state and
local SQLite database should not be split across multiple service instances.

## What we added

### Game play

- Host room creation and player joining with five-character codes.
- Lobby player list with online/offline state and QR invite.
- Question countdowns controlled by server timers.
- Random option order per player, with the mapping retained on the server.
- Correct answers sent only during reveal.
- Correct score formula:

  ```text
  1000 * (0.5 + 0.5 * timeLeft / timeLimit)
  ```

  Incorrect answers score zero.
- Leaderboard rank changes showing climbed, dropped, same, or new positions.

### Reconnection and security

- A session token identifies a player across refreshes or socket reconnects.
- A reconnecting player recovers their identity, score, active question view,
  shuffled options, and remaining time.
- New players cannot join after the game starts.
- Duplicate names, invalid room codes, invalid session tokens, late answers,
  duplicate answers, and non-member answers are rejected.
- Event payloads use strict Zod schemas.
- Socket events are rate-limited.
- Only the host can start or skip a question.
- Session tokens and internal IDs are not broadcast in room or leaderboard
  payloads.

### Content, leagues, and results

- Question-set and question CRUD endpoints support creating, editing,
  reordering, and deleting content.
- Questions support text, JSON options, correct index, topic, difficulty,
  image URL, and table JSON.
- Completed games write player scores to the college league.
- League filters support today, this week, all time, college, and result limits.
- Host dashboard includes question accuracy, most-missed questions, topic
  accuracy, and all player/question rows as CSV.

## How to run it

### Local development

Requirements: Node.js and npm.

```bash
git clone https://github.com/sunnyy2006-prog/AptiQuiz.git
cd AptiQuiz
npm install
cp .env.example .env
npm run seed --workspace server
npm run dev
```

Open:

- Client: `http://localhost:5173`
- Server/API: `http://localhost:3001`
- Health check: `http://localhost:3001/api/health`

The Vite development server proxies `/api` and Socket.IO traffic to the
server. Useful commands:

```bash
npm run check
npm test --workspace server
npm run build
npm start
```

### Production build

```bash
npm install
npm run build
npm start
```

The server serves the built client from `client/dist`.

### Live URL

No live deployment URL is committed or configured in this repository. After
creating the Render service, replace the following examples with the actual
service URL:

```text
App:    https://<your-service>.onrender.com
Health: https://<your-service>.onrender.com/api/health
```

The health response should be:

```json
{"status":"ok","service":"aptiquiz-server"}
```

### Render deployment

The repository includes [`render.yaml`](./render.yaml) for one Render web
service:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health-check path: `/api/health`
- SQLite database path: `/var/data/aptiquiz.db`
- Persistent disk mount: `/var/data`

Dashboard steps:

1. In Render, choose **New +** → **Web Service**.
2. Connect `sunnyy2006-prog/AptiQuiz`.
3. Select the `main` branch.
4. Leave **Root Directory** blank so commands run from the repository root.
5. Choose the Node runtime.
6. Set **Build Command** to `npm install && npm run build`.
7. Set **Start Command** to `npm start`.
8. Set **Health Check Path** to `/api/health`.
9. Add:
   - `NODE_ENV=production`
   - `DATABASE_PATH=/var/data/aptiquiz.db`
   - `CLIENT_ORIGIN=https://<your-service>.onrender.com`
10. Do not set `PORT`; Render supplies it.
11. Add a persistent disk mounted at `/var/data`, at least 1 GB.
12. Create the service and verify the health URL.

Without the persistent disk, SQLite data can disappear on redeploy or service
replacement. Keep this deployment at one instance because live room state is
held in memory and SQLite is local to the mounted disk.

## Plain-words fairness and reliability

### How we handle network delay fairly

The server starts and ends each question. It records when the question was
sent to each player and measures that player's answer time on the server. The
browser cannot add time, submit on behalf of another player, choose a correct
answer, or change the score. The server ignores answers after the deadline and
duplicate answers. A small network delay can still affect when a packet reaches
the server; the important rule is that the same server-side deadline and timing
logic are used for everyone.

### How reconnection works

When a player joins, the server returns a session token. The client stores it in
`localStorage`. If the browser refreshes or the socket drops, the client sends
the room code and token when it reconnects. The server restores the same player
instead of creating a new one. During an active question it sends that player
their own shuffled options and the remaining server-calculated time. A finished
room cannot be rejoined.

### Anti-cheating measures

- Correct answers are withheld until the reveal event.
- Options are shuffled separately for each player.
- The server, not the client, maps a submitted option to the real answer.
- The server checks room membership, active socket identity, current question,
  duplicate state, option bounds, and deadline.
- Only the host session can start or skip.
- Strict Zod validation rejects malformed event payloads.
- Per-socket rate limits reduce event flooding.
- Session tokens and internal player IDs are not included in broadcasts.
- Duplicate names and joins after game start are rejected.

These controls do not claim to prevent every possible real-world attack, but
they address the realistic cheating paths in this browser-based game.

## 50-player test

Run the test after installing dependencies and seeding questions:

```bash
npm install
npm run seed --workspace server
```

Start the server in another terminal. Short timers make a local test finish
faster:

```bash
QUESTION_TIME_LIMIT_MS=1000 \
REVEAL_DURATION_MS=200 \
LEADERBOARD_DURATION_MS=200 \
npm start
```

Then run:

```bash
npm run loadtest --workspace server -- \
  --url http://localhost:3001 \
  --answer-window-ms 700
```

Against a deployed service:

```bash
npm run loadtest --workspace server -- \
  --url https://<your-service>.onrender.com \
  --answer-window-ms 5000
```

The script creates one host and 49 players, sends random answers at random
times, disconnects and reconnects five players during the first question, and
prints:

- Join success rate
- Average answer acknowledgement latency
- p95 answer acknowledgement latency
- Rejected answers and captured errors
- Whether the final leaderboard has 50 unique players, sequential ranks, and
  non-increasing scores

The script is a measurement tool; this repository does not contain a recorded
test run or claim a benchmark result. Its process exits non-zero if joining is
incomplete or the final leaderboard fails its consistency checks.

## Tools and AI used

- Node.js and npm for the monorepo scripts and server runtime.
- Express for HTTP APIs and serving the production client.
- Socket.IO and `socket.io-client` for real-time game traffic and load testing.
- React, Vite, Tailwind CSS, Recharts, and `qrcode.react` for the client.
- SQLite through `better-sqlite3` for persistence.
- Zod for event and REST input validation.
- Git and GitHub for version control and source hosting.
- Render configuration through `render.yaml` for one-service deployment.
- AI assistance through Copilot SDK in VS Code was used to help implement,
  inspect, document, and test the code. The repository remains the source of
  truth for what is actually implemented.

## Who it is for

- Students preparing for aptitude tests.
- College clubs, classrooms, and peer groups running live quiz sessions.
- Hosts who want quick room setup and post-game analysis.
- Developers evaluating a small server-authoritative real-time multiplayer
  application with Socket.IO and SQLite.

## Repository

<https://github.com/sunnyy2006-prog/AptiQuiz>
