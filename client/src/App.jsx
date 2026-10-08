import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { Avatar, Badge, Button, GlassCard, ScreenTransition, SoundToggle, TimerBar, Toast, useSound } from "./components/ui";

const LandingScene = lazy(() => import("./components/LandingScene"));
const Podium = lazy(() => import("./components/Podium"));
const TopicAccuracyChart = lazy(() => import("./components/Charts").then((module) => ({ default: module.TopicAccuracyChart })));
const QuestionAccuracyChart = lazy(() => import("./components/Charts").then((module) => ({ default: module.QuestionAccuracyChart })));

const socket = io();
const STORAGE = {
  code: "aptiquiz.roomCode",
  name: "aptiquiz.playerName",
  token: "aptiquiz.sessionToken"
};

const colors = {
  ink: "#f5f7ff",
  muted: "#9aa8c7",
  teal: "#32d6ff",
  coral: "#ff6b7a",
  gold: "#c8f66b"
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [mode, setMode] = useState("join");
  const [name, setName] = useState(() => localStorage.getItem(STORAGE.name) || "");
  const [code, setCode] = useState(() => localStorage.getItem(STORAGE.code) || "");
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(STORAGE.token) || "");
  const [collegeName, setCollegeName] = useState("");
  const [room, setRoom] = useState(null);
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [leaguePeriod, setLeaguePeriod] = useState("all");
  const [leagueCollege, setLeagueCollege] = useState("");
  const [leagueData, setLeagueData] = useState({ players: [], colleges: [] });
  const [hostResults, setHostResults] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [loading, setLoading] = useState(false);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("aptiquiz.sound") === "on");
  const playSound = useSound(soundEnabled);
  const currentQuestion = useRef(question);

  useEffect(() => {
    if (screen !== "league") return;
    setLeagueLoading(true);
    const query = new URLSearchParams({ period: leaguePeriod });
    if (leagueCollege) query.set("collegeId", leagueCollege);
    fetch(`/api/league?${query}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the league.");
        return response.json();
      })
      .then(setLeagueData)
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLeagueLoading(false));
  }, [screen, leaguePeriod, leagueCollege]);

  useEffect(() => {
    const onRoom = (data) => {
      setRoom((current) => ({ ...current, ...data }));
      if (data.code) {
        setCode(data.code);
        localStorage.setItem(STORAGE.code, data.code);
      }
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
        localStorage.setItem(STORAGE.token, data.sessionToken);
      }
      if (data.reconnected) setError("");
      setLoading(false);
      setScreen("lobby");
    };
    const onState = (data) => {
      setRoom((current) => ({ ...current, ...data }));
      setLeaderboard(data.players || []);
      if (data.state === "question") setScreen("question");
      if (data.state === "reveal") setScreen("reveal");
      if (data.state === "leaderboard") setScreen("leaderboard");
      if (data.state === "finished") setScreen("results");
    };
    const onQuestion = (data) => {
      setQuestion(data);
      setReveal(null);
      setAnswered(false);
      setSelectedOption(null);
      setSeconds(Math.ceil((data.remainingMs ?? data.timeLimitMs) / 1000));
      setScreen("question");
    };
    const onReveal = (data) => {
      setReveal(data);
      setQuestion((current) => ({ ...current, ...data }));
      setScreen("reveal");
    };
    const onLeaderboard = ({ leaderboard: next, state }) => {
      setLeaderboard(next || []);
      setScreen(state === "finished" ? "results" : "leaderboard");
    };
    const onAnswer = (result) => {
      if (result.accepted) {
        playSound("tap");
        setAnswered(true);
        setAnswers((current) => [...current, { ...result, topic: currentQuestion.current?.topic }]);
      } else {
        playSound("error");
        setError(result.reason);
      }
    };
    const onHostResults = (data) => {
      setHostResults(data);
      setScreen("host-results");
    };
    const onError = ({ message }) => {
      setLoading(false);
      setError(message);
      if (/not found|closed|token is not valid/i.test(message)) {
        localStorage.removeItem(STORAGE.code);
        localStorage.removeItem(STORAGE.token);
      }
    };
    const onConnect = () => {
      setConnection("connected");
      const storedCode = localStorage.getItem(STORAGE.code);
      const token = localStorage.getItem(STORAGE.token);
      const storedName = localStorage.getItem(STORAGE.name);
      if (storedCode && token) socket.emit("room:join", { code: storedCode, sessionToken: token, playerName: storedName });
    };
    const onDisconnect = () => setConnection("disconnected");

    socket.on("connect", onConnect);
    socket.on("room:created", onRoom);
    socket.on("room:joined", onRoom);
    socket.on("room:state", onState);
    socket.on("question:start", onQuestion);
    socket.on("question:reveal", onReveal);
    socket.on("game:leaderboard", onLeaderboard);
    socket.on("game:answer-result", onAnswer);
    socket.on("host:results", onHostResults);
    socket.on("room:error", onError);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("room:created", onRoom);
      socket.off("room:joined", onRoom);
      socket.off("room:state", onState);
      socket.off("question:start", onQuestion);
      socket.off("question:reveal", onReveal);
      socket.off("game:leaderboard", onLeaderboard);
      socket.off("game:answer-result", onAnswer);
      socket.off("host:results", onHostResults);
      socket.off("room:error", onError);
      socket.off("disconnect", onDisconnect);
    };
  }, [playSound]);

  useEffect(() => { currentQuestion.current = question; }, [question]);
  useEffect(() => { localStorage.setItem("aptiquiz.sound", soundEnabled ? "on" : "off"); }, [soundEnabled]);

  useEffect(() => {
    if (screen !== "question" || seconds <= 0) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen, seconds]);

  const isHost = room?.isHost ?? false;
  const accuracy = answers.length ? Math.round((answers.filter((answer) => answer.isCorrect).length / answers.length) * 100) : 0;
  const averageSpeed = answers.length ? Math.round(answers.reduce((total, answer) => total + (answer.answerTimeMs || 0), 0) / answers.length / 100) / 10 : 0;
  const topics = useMemo(() => {
    const byTopic = answers.reduce((all, answer) => {
      const current = all[answer.topic || "Mixed"] || { correct: 0, total: 0 };
      current.total += 1;
      current.correct += answer.isCorrect ? 1 : 0;
      all[answer.topic || "Mixed"] = current;
      return all;
    }, {});
    return Object.entries(byTopic).map(([topic, value]) => ({ topic, accuracy: Math.round((value.correct / value.total) * 100) }));
  }, [answers]);

  function submit(event) {
    event.preventDefault();
    setError("");
    if (!name.trim()) return setError("Enter your name to continue.");
    if (mode === "join" && code.length !== 5) return setError("Room codes are exactly 5 characters.");
    setLoading(true);
    localStorage.setItem(STORAGE.name, name);
    if (mode === "create") {
      socket.emit("room:create", { playerName: name, collegeName: collegeName || undefined });
    } else {
      socket.emit("room:join", { code: code.toUpperCase(), playerName: name, sessionToken: localStorage.getItem(STORAGE.code) === code.toUpperCase() ? sessionToken : undefined });
    }
  }

  function answer(index) {
    if (!answered && screen === "question") {
      setSelectedOption(index);
      socket.emit("game:answer", { optionIndex: index });
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setScreen("home")} type="button" aria-label="Go to AptiQuiz home">
          <span className="brand-mark">A</span>
          <span>Apti<span>Quiz</span></span>
        </button>
        <button className="league-link" onClick={() => setScreen("league")} type="button">View league <span>↗</span></button>
        <SoundToggle enabled={soundEnabled} onChange={setSoundEnabled} />
      </header>
      {connection === "disconnected" && <div className="connection-banner" role="status">Connection lost. Reconnecting…</div>}
      <main className="page">
        <ScreenTransition key={screen}>
          {screen === "home" && <Home mode={mode} setMode={setMode} name={name} setName={setName} code={code} setCode={setCode} collegeName={collegeName} setCollegeName={setCollegeName} submit={submit} error={error} loading={loading} />}
          {screen === "lobby" && <Lobby room={room} code={code} name={name} isHost={isHost} error={error} onStart={() => socket.emit("game:start")} />}
          {screen === "question" && question && <Question question={question} seconds={seconds} answered={answered} selectedOption={selectedOption} answer={answer} />}
          {screen === "reveal" && <Reveal reveal={reveal} />}
          {screen === "leaderboard" && <Leaderboard leaderboard={leaderboard} playerName={name} />}
          {screen === "results" && <Results leaderboard={leaderboard} playerName={name} accuracy={accuracy} averageSpeed={averageSpeed} topics={topics} isHost={isHost} onDashboard={() => socket.emit("host:results")} onHome={() => window.location.reload()} />}
          {screen === "host-results" && <HostResults data={hostResults} onHome={() => window.location.reload()} />}
          {screen === "league" && <League period={leaguePeriod} setPeriod={setLeaguePeriod} college={leagueCollege} setCollege={setLeagueCollege} data={leagueData} loading={leagueLoading} error={error} onHome={() => setScreen("home")} />}
        </ScreenTransition>
      </main>
      <Toast message={error} onDismiss={() => setError("")} />
    </div>
  );
}

function Home({ mode, setMode, name, setName, code, setCode, collegeName, setCollegeName, submit, error, loading }) {
  return (
    <section className="hero-grid landing-hero">
      <div className="landing-visual" aria-hidden="true">
        <div className="scene-glow" />
        <Suspense fallback={<div className="scene-fallback" />}>
          <LandingScene />
        </Suspense>
      </div>
      <div className="hero-copy">
        <div className="hero-logo"><span className="brand-mark">A</span><span>Apti<span>Quiz</span></span></div>
        <div className="eyebrow">Fast minds. One arena.</div>
        <h1>Think fast.<br /><em>Play smarter.</em></h1>
        <p>Real-time aptitude battles for college teams. Join a room, challenge your crew, and climb the board.</p>
        <div className="landing-actions">
          <button className={`landing-action ${mode === "join" ? "selected" : ""}`} onClick={() => setMode("join")} type="button">
            <span className="action-icon" aria-hidden="true">↗</span><span><strong>Join with code</strong><small>Enter a 5-character room code</small></span>
          </button>
          <button className={`landing-action ${mode === "create" ? "selected" : ""}`} onClick={() => setMode("create")} type="button">
            <span className="action-icon" aria-hidden="true">✦</span><span><strong>Host a game</strong><small>Create a room for your team</small></span>
          </button>
        </div>
        <div className="trust-row"><span>✦ Live rounds</span><span>◈ Up to 50 players</span><span>◉ No sign-up</span></div>
      </div>
      <GlassCard className="join-card"><form onSubmit={submit}>
        <h2>{mode === "create" ? "Start a challenge" : "Enter the arena."}</h2>
        <p className="card-note">{mode === "create" ? "You’ll be the host. Invite your team with a room code." : "Enter the code your host shared with you."}</p>
        <label>Your name<input autoComplete="nickname" maxLength="40" onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya" required value={name} /></label>
        {mode === "create" && <label>College <span className="optional-label">(optional)</span><input maxLength="120" onChange={(event) => setCollegeName(event.target.value)} placeholder="e.g. Delhi University" value={collegeName} /></label>}
        {mode === "join" && <label>Room code<input aria-describedby="code-help code-error" aria-invalid={Boolean(error)} autoCapitalize="characters" autoComplete="one-time-code" inputMode="text" maxLength="5" onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase())} placeholder="ABCDE" required value={code} /><small id="code-help">5 characters, shown by your host</small></label>}
        {error && <p className="error" id="code-error" role="alert">! {error}</p>}
        <Button disabled={loading} type="submit">{loading ? "Connecting…" : mode === "create" ? "Create room →" : "Join room →"}</Button>
        <p className="privacy-note">Your name is only visible to players in this room.</p>
      </form></GlassCard>
    </section>
  );
}

function Lobby({ room, code, name, isHost, error, onStart }) {
  const players = room?.players || [];
  const inviteUrl = `${window.location.origin}/?room=${code}`;
  const visiblePlayers = players.slice(0, 24);
  const extraPlayers = Math.max(0, players.length - visiblePlayers.length);
  return (
    <section className={`lobby-layout ${isHost ? "host-lobby" : "player-lobby"}`}>
      <div className="section-heading lobby-heading"><div><div className="eyebrow">{isHost ? "Host control room" : "Room lobby"}</div><h1>{isHost ? "Your arena is ready." : "You’re in the arena."}</h1><p>{isHost ? "Share the code, watch your team arrive, then launch the first round." : "Your host will start the first round when everyone is ready."}</p></div><Badge tone="lime"><i className="status-dot" /> Live lobby</Badge></div>
      <div className="lobby-grid">
        <GlassCard className="code-card"><div><span className="label">JOIN CODE</span><strong>{code}</strong><button className="copy-button" onClick={() => navigator.clipboard?.writeText(code)} type="button">Copy code <span aria-hidden="true">⧉</span></button><p className="invite-note">Scan or share this code with your team.</p></div><div className="qr-frame"><QRCodeSVG bgColor="#141d3b" fgColor={colors.ink} level="M" size={128} value={inviteUrl} title="QR code to join this room" /></div></GlassCard>
        <GlassCard className="players-card"><div className="card-top"><div><span className="label">PLAYERS JOINED</span><h2>{players.length}<small> / 50</small></h2></div><Badge>{isHost ? "Host" : `You: ${name}`}</Badge></div><div className="player-avatar-grid" aria-label={`${players.length} players joined`}>{visiblePlayers.map((player, index) => <motion.div className="player-avatar" layout key={`${player.name}-${index}`} initial={{ opacity: 0, scale: 0.35, y: -18, rotate: -8 }} animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 24, mass: 0.55 }} title={player.name}><Avatar name={player.name} /><span>{player.name}</span></motion.div>)}{extraPlayers > 0 && <span className="avatar-overflow">+{extraPlayers}</span>}</div><div className="player-status-line"><span><i className="online-dot" /> {players.length ? `${players.length} ${players.length === 1 ? "player is" : "players are"} ready` : "Waiting for your first player"}</span><span className="capacity-meter" aria-label={`${players.length} of 50 player slots used`}><span style={{ width: `${Math.min(100, players.length * 2)}%` }} /></span></div>{error && <p className="error" role="alert">{error}</p>}{isHost ? <Button disabled={players.length < 1} onClick={onStart} type="button">Start game <span>→</span></Button> : <PlayerWaiting name={name} />}</GlassCard>
      </div>
      {!isHost && <ScoringRules />}
    </section>
  );
}

function PlayerWaiting({ name }) {
  return <div className="player-waiting"><Avatar name={name} /><div><strong>{name || "Player"}</strong><span><i className="pulse-dot" /> Waiting for host</span></div></div>;
}

function ScoringRules() {
  return <details className="scoring-rules"><summary><span><span className="rules-icon" aria-hidden="true">✦</span> How scoring works</span><span aria-hidden="true">＋</span></summary><div className="rules-content"><div><strong>1000</strong><span>Base points</span></div><div><strong>+ speed</strong><span>Faster answers score more</span></div><div><strong>0</strong><span>Incorrect answers</span></div></div></details>;
}

function Question({ question, seconds, answered, selectedOption, answer }) {
  const shapes = ["◆", "●", "▲", "✚"];
  return <section className="game-panel question-screen">
    <div className="question-meta"><span>QUESTION {question.questionNumber} <b>/ {question.totalQuestions}</b></span><Badge>{question.topic || "Aptitude"}</Badge></div>
    <div className={`countdown-row ${seconds <= 5 ? "countdown-danger" : seconds <= 10 ? "countdown-warning" : ""}`}><strong aria-label={`${seconds} seconds remaining`}>{seconds}s</strong><TimerBar max={question.timeLimitMs / 1000} value={seconds} /><span className="countdown-label">Time left</span></div>
    <GlassCard className="question-card"><h1 className="question-title">{question.text}</h1>{question.imageUrl && <img className="question-image" src={question.imageUrl} alt="" />}{question.tableJson && <QuestionTable data={question.tableJson} />}</GlassCard>
    <div className="options-grid">{question.options.map((option, index) => <motion.button whileTap={answered ? undefined : { scale: 0.97, y: 3 }} aria-label={`Option ${String.fromCharCode(65 + index)}: ${option}`} className={`option-button option-${index} ${selectedOption === index ? "selected" : ""}`} disabled={answered || seconds === 0} key={`${option}-${index}`} onClick={() => answer(index)} type="button"><span className={`option-shape shape-${index}`} aria-hidden="true">{shapes[index] || "◇"}</span><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">{option}</span></motion.button>)}</div>
    {answered && <div className="answer-confirmation" role="status">✓ Answer locked in. Nice work.</div>}
  </section>;
}

function Reveal({ reveal }) {
  const selectedIndex = reveal?.answer?.selectedIndex;
  const correctIndex = reveal?.correctShuffledIndex;
  return <section className="reveal-panel question-screen"><div className="result-icon">✓</div><div className="eyebrow">Answer revealed</div><h1>{reveal?.correctOption || "Round complete"}</h1><p className="reveal-copy">The correct answer is highlighted. Here’s how you did this round.</p>{reveal?.options && <div className="reveal-options">{reveal.options.map((option, index) => <div className={`reveal-option ${index === correctIndex ? "reveal-correct" : ""} ${index === selectedIndex && index !== correctIndex ? "reveal-wrong" : ""}`} key={`${option}-${index}`}><span className="option-shape" aria-hidden="true">{["◆", "●", "▲", "✚"][index] || "◇"}</span><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option}</span><strong aria-label={index === correctIndex ? "Correct answer" : index === selectedIndex ? "Your incorrect answer" : ""}>{index === correctIndex ? "✓" : index === selectedIndex ? "✕" : ""}</strong></div>)}</div>}{reveal?.answer?.points > 0 && <motion.div className="points-flyup" initial={{ opacity: 0, y: 22, scale: .8 }} animate={{ opacity: 1, y: -4, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>+{reveal.answer.points}</motion.div>}<div className="reveal-stats"><div><span>Your points</span><strong>{reveal?.answer?.points ?? 0}</strong></div><div><span>Result</span><strong className={reveal?.answer?.isCorrect ? "correct-text" : "muted-text"}>{reveal?.answer?.isCorrect ? "Correct" : "Keep going"}</strong></div></div></section>;
}

function QuestionTable({ data }) {
  const rows = Array.isArray(data) ? data : data?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  return <div className="question-table-wrap"><table className="question-table"><tbody>{rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{(Array.isArray(row) ? row : Object.values(row)).slice(0, 6).map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>)}</tbody></table></div>;
}

function Leaderboard({ leaderboard, playerName }) {
  const previousScores = useRef(new Map());
  const playerRow = useRef(null);
  useEffect(() => {
    playerRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    previousScores.current = new Map(leaderboard.map((player) => [player.name, player.score]));
  }, [leaderboard]);
  return <section className="leaderboard-panel"><div className="section-heading"><div><div className="eyebrow">Between rounds</div><h1>Live standings</h1><p>Every point changes the game.</p></div><span className="trophy">♛</span></div><div className="leaderboard-list leaderboard-scroll">{leaderboard.map((player) => { const gained = Math.max(0, player.score - (previousScores.current.get(player.name) || 0)); const current = player.name === playerName; return <motion.div className={`rank-row rank-${player.rank} ${current ? "current-player" : ""}`} layout key={player.name} ref={current ? playerRow : undefined} transition={{ type: "spring", stiffness: 480, damping: 34 }}><strong>{player.rank}</strong><span className={`rank-arrow ${player.rankChange}`}>{player.rankChange === "climbed" ? "↑" : player.rankChange === "dropped" ? "↓" : "—"}</span><Avatar name={player.name} /><span className="rank-name">{player.name}{current && <small className="you-label">YOU</small>}</span><span className="rank-score">{player.score}<small> pts</small>{gained > 0 && <em>+{gained}</em>}</span></motion.div>; })}</div></section>;
}

function Results({ leaderboard, playerName, accuracy, averageSpeed, topics, isHost, onDashboard, onHome }) {
  const player = leaderboard.find((entry) => entry.name === playerName) || leaderboard[0];
  const summary = `${player?.name || "The player"} scored ${player?.score || 0} points with ${accuracy}% accuracy and an average answer speed of ${averageSpeed} seconds. Strongest topics: ${topics.map((topic) => `${topic.topic} at ${topic.accuracy}%`).join(", ") || "Keep playing to reveal your strengths"}.`;
  return <section className="results-panel"><div className="eyebrow">Game complete</div><h1>That’s a wrap.</h1><p className="results-copy">A sharp finish. Here’s your performance snapshot.</p><Suspense fallback={<div className="podium-2d podium-loading" aria-label="Loading podium" />}><Podium players={leaderboard} /></Suspense><div className="metrics"><div><strong>{player?.score || 0}</strong><span>Total points</span></div><div><strong>{accuracy}%</strong><span>Accuracy</span></div><div><strong>{averageSpeed}s</strong><span>Avg. speed</span></div></div><div className="chart-card"><div className="card-top"><div><span className="label">TOPIC STRENGTHS</span><h2>Where you shine</h2></div><span className="chart-legend"><i /> Accuracy</span></div><div className="chart-wrap"><Suspense fallback={<div className="chart-loading">Loading chart…</div>}><TopicAccuracyChart topics={topics} /></Suspense><p className="sr-only" role="status">{summary}</p></div></div>{isHost && <button className="primary-button" onClick={onDashboard} type="button">Open host dashboard →</button>}<button className="secondary-button" onClick={onHome} type="button">Back to home</button></section>;
}

function HostResults({ data, onHome }) {
  if (!data) return <section className="results-panel"><p className="error">Results are not available.</p></section>;
  const downloadCsv = () => {
    const columns = ["Player", "Question", "Topic", "Selected option", "Correct option", "Correct", "Answered at"];
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = data.players.map((row) => [
      row.name, row.question, row.topic || "", row.selectedIndex === null ? "" : row.selectedIndex + 1,
      row.correctIndex + 1, row.isCorrect ? "Yes" : "No", row.answeredAt || ""
    ]);
    const csv = [columns, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aptiquiz-${data.roomCode}-results.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return <section className="host-results-panel"><div className="section-heading"><div><div className="eyebrow">Host dashboard · {data.roomCode}</div><h1>Results, at a glance.</h1><p>See where the room found its edge and where it got stuck.</p></div><button className="back-link" onClick={onHome} type="button">← Home</button></div><div className="dashboard-actions"><button className="primary-button" onClick={downloadCsv} type="button">Download all results (CSV)</button></div><div className="dashboard-grid"><div className="chart-card"><span className="label">PER-QUESTION ACCURACY</span><h2>How the room performed</h2><div className="dashboard-table">{data.questions.map((item) => <div className="dashboard-row" key={item.questionId}><span><b>Q{item.questionNumber}</b> {item.text}</span><strong>{item.percentageCorrect}%<small>{item.correctCount}/{item.missedCount + item.answerCount} correct</small></strong></div>)}</div></div><div className="chart-card"><span className="label">MOST MISSED</span><h2>Needs another look</h2><div className="dashboard-table">{data.mostMissed.map((item) => <div className="dashboard-row" key={item.questionId}><span><b>Q{item.questionNumber}</b> {item.text}</span><strong>{item.missedCount}<small>missed</small></strong></div>)}</div></div><div className="chart-card topic-dashboard"><span className="label">TOPIC ACCURACY</span><h2>Strength by topic</h2><div className="chart-wrap"><ResponsiveContainer height={230} width="100%"><BarChart data={data.topics} layout="vertical" margin={{ left: 14, right: 18 }}><CartesianGrid horizontal={false} stroke="#e5e1d9" /><XAxis domain={[0, 100]} hide type="number" /><YAxis axisLine={false} dataKey="topic" tick={{ fill: colors.muted, fontSize: 12 }} tickLine={false} type="category" width={110} /><Tooltip formatter={(value) => [`${value}%`, "Accuracy"]} /><Bar dataKey="accuracy" fill={colors.coral} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div></div></section>;
}

function League({ period, setPeriod, college, setCollege, data, loading, error, onHome }) {
  const [colleges, setColleges] = useState([]);
  useEffect(() => {
    fetch("/api/league/colleges").then((response) => response.json()).then(({ colleges: available }) => setColleges(available || []));
  }, []);
  return <section className="league-panel">
    <div className="section-heading"><div><div className="eyebrow">AptiQuiz league</div><h1>Play for your campus.</h1><p>See who is leading across every live challenge.</p></div><button className="back-link" onClick={onHome} type="button">← Home</button></div>
    <div className="league-controls" aria-label="League filters">
      <div className="period-tabs" role="tablist" aria-label="Time period">
        {[["today", "Today"], ["week", "This week"], ["all", "All time"]].map(([value, label]) => <button className={period === value ? "active" : ""} key={value} onClick={() => setPeriod(value)} role="tab" type="button">{label}</button>)}
      </div>
      <label className="filter-label">College
        <select aria-label="Filter by college" onChange={(event) => setCollege(event.target.value)} value={college}>
          <option value="">All colleges</option>
          {colleges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    {loading && <p className="loading-state" role="status">Loading league standings…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="league-grid">
      <div className="league-card"><div className="card-top"><div><span className="label">TOP PLAYERS</span><h2>Sharpest minds</h2></div><span className="trophy">♛</span></div><div className="league-table">{data.players.length ? data.players.map((player, index) => <div className="league-row" key={`${player.name}-${player.college}`}><strong>{index + 1}</strong><span className="avatar">{player.name.charAt(0)}</span><span className="league-name">{player.name}<small>{player.college} · {player.games_played} games</small></span><b>{player.points}<small> pts</small></b></div>) : <p className="empty-state">No scores for this period yet.</p>}</div></div>
      <div className="league-card"><div className="card-top"><div><span className="label">TOP COLLEGES</span><h2>Campus cup</h2></div><span className="trophy">✦</span></div><div className="league-table">{data.colleges.length ? data.colleges.map((item, index) => <div className="league-row" key={item.name}><strong>{index + 1}</strong><span className="college-icon">◎</span><span className="league-name">{item.name}<small>{item.players} players · {item.accuracy}% accuracy</small></span><b>{item.points}<small> pts</small></b></div>) : <p className="empty-state">No college scores yet.</p>}</div></div>
    </div>
  </section>;
}
