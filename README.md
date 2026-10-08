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

## Deploy on Render

This repository includes [`render.yaml`](./render.yaml) for a single Render
Web Service. It builds the client and starts the server from the repository
root:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check: `GET /api/health`
- SQLite path: `/var/data/aptiquiz.db`

### Render dashboard setup

1. Push the repository to GitHub and open the Render dashboard.
2. Select **New +** → **Web Service**, then connect
   `sunnyy2006-prog/AptiQuiz`.
3. Choose the `main` branch and set **Root Directory** to the repository root
   (leave it blank if Render already shows the root).
4. Set **Runtime** to **Node**.
5. Set **Build Command** to `npm install && npm run build`.
6. Set **Start Command** to `npm start`.
7. Set **Health Check Path** to `/api/health`.
8. Add these environment variables under **Environment**:
   - `NODE_ENV` = `production`
   - `DATABASE_PATH` = `/var/data/aptiquiz.db`
   - `CLIENT_ORIGIN` = the deployed app URL, for example
     `https://aptiquiz.onrender.com`
   - Do not set `PORT`; Render supplies it automatically.
9. Under **Disks**, click **Add Disk**, use mount path `/var/data`, and choose
   a size such as `1 GB`. The disk is required because SQLite data stored on
   the service filesystem is lost on redeploys/restarts without persistent
   storage.
10. Choose the instance size, click **Create Web Service**, and wait for the
    first deploy to finish.
11. Open `https://<your-service>.onrender.com/api/health`; it should return
    `{"status":"ok","service":"aptiquiz-server"}`.
12. Open the service URL in a browser and test room creation and a second
    browser joining. Socket.IO, API requests, and the built React client all
    use the same web service URL.

Instead of entering the settings manually, Render can use **New +** →
**Blueprint** and the committed `render.yaml`. If you use the Blueprint,
still set the `CLIENT_ORIGIN` value to the final Render URL when prompted.

### SQLite persistence and scaling

The persistent disk keeps `DATABASE_PATH=/var/data/aptiquiz.db` across
deploys and restarts. Without a disk, the app is suitable only for temporary
testing and league/game history can be lost. Render persistent disks are
attached to one service instance, so keep this app at one instance for the
in-memory Socket.IO room engine and SQLite database. Moving to multiple
instances requires shared database storage and Socket.IO adapter/session
coordination; SQLite on a local disk is not suitable for that setup.

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

## Load testing

`server/scripts/loadtest.js` simulates 50 players in one room. It measures
join success rate, answer acknowledgement latency (average and p95), errors,
and validates that the final leaderboard contains all 50 unique players with
sequential ranks and descending scores. Five players disconnect during the
first question and reconnect with their session tokens.

Install dependencies and seed questions first:

```bash
npm install
npm run seed --workspace server
```

Run against a local server in another terminal. Shorter timers make the test
finish faster:

```bash
QUESTION_TIME_LIMIT_MS=1000 REVEAL_DURATION_MS=200 LEADERBOARD_DURATION_MS=200 npm start
npm run loadtest --workspace server -- --url http://localhost:3001 --answer-window-ms 700
```

For a deployed server, pass its public Socket.IO URL:

```bash
npm run loadtest --workspace server -- --url https://quiz.example.com --answer-window-ms 5000
```

Optional flags are `--reconnect-delay-ms`, `--timeout-ms`, and
`--answer-window-ms`. The script exits with a non-zero status if all joins do
not succeed or the final leaderboard is inconsistent.

## Host results dashboard

After a game finishes, the host can open **Open host dashboard** from the
results screen. The dashboard shows percentage correct per question, the five
most-missed questions, and topic-level accuracy. **Download all results
(CSV)** exports one row for every player/question pair, including the selected
option, correct option, correctness, and answer timestamp. Results are
requested over a host-authenticated Socket.IO event and are not exposed by a
public room-code endpoint.
