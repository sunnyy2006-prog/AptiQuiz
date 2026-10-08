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

const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 8,
  reconnectionDelay: 500,
  reconnectionDelayMax: 8000,
  randomizationFactor: 0.25
});
const spectatorRoomCode = window.location.pathname.match(/^\/spectate\/([A-Za-z0-9]{5})\/?$/)?.[1]?.toUpperCase();
const practicePath = window.location.pathname.replace(/\/+$/, "") === "/practice";
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
  if (spectatorRoomCode) return <SpectatorApp roomCode={spectatorRoomCode} />;
  if (practicePath) return <PracticeApp />;

  const [screen, setScreen] = useState("home");
  const [profile, setProfile] = useState(null);
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
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
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
      if (data.state === "question" || data.state === "paused") {
        setQuestion((current) => current ? { ...current, paused: data.state === "paused" } : current);
        setScreen("question");
      }
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
    const onPowerUp = (result) => {
      if (!result.accepted) {
        playSound("error");
        setError(result.reason);
        return;
      }
      playSound("tap");
      setQuestion((current) => ({
        ...current,
        powerUps: result.powerUps,
        removedOptionIndices: result.removedOptionIndices || current.removedOptionIndices || []
      }));
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
      setReconnectAttempt(0);
      const storedCode = localStorage.getItem(STORAGE.code);
      const token = localStorage.getItem(STORAGE.token);
      const storedName = localStorage.getItem(STORAGE.name);
      if (storedCode && token) socket.emit("room:join", { code: storedCode, sessionToken: token, playerName: storedName });
    };
    const onDisconnect = () => setConnection("disconnected");
    const onReconnectAttempt = (attempt) => {
      setReconnectAttempt(attempt);
      setConnection("reconnecting");
    };
    const onReconnectFailed = () => setConnection("failed");
    const onConnectError = () => setConnection("reconnecting");

    socket.on("connect", onConnect);
    socket.on("room:created", onRoom);
    socket.on("room:joined", onRoom);
    socket.on("room:state", onState);
    socket.on("question:start", onQuestion);
    socket.on("question:reveal", onReveal);
    socket.on("game:leaderboard", onLeaderboard);
    socket.on("game:answer-result", onAnswer);
    socket.on("power-up:result", onPowerUp);
    socket.on("host:results", onHostResults);
    socket.on("room:error", onError);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.on("connect_error", onConnectError);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("room:created", onRoom);
      socket.off("room:joined", onRoom);
      socket.off("room:state", onState);
      socket.off("question:start", onQuestion);
      socket.off("question:reveal", onReveal);
      socket.off("game:leaderboard", onLeaderboard);
      socket.off("game:answer-result", onAnswer);
      socket.off("power-up:result", onPowerUp);
      socket.off("host:results", onHostResults);
      socket.off("room:error", onError);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.off("connect_error", onConnectError);
    };
  }, [playSound]);

  function retryConnection() {
    setConnection("reconnecting");
    setReconnectAttempt(0);
    socket.connect();
  }

  useEffect(() => { currentQuestion.current = question; }, [question]);
  useEffect(() => { localStorage.setItem("aptiquiz.sound", soundEnabled ? "on" : "off"); }, [soundEnabled]);

  useEffect(() => {
    if (screen !== "question" || seconds <= 0 || question?.paused) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen, seconds, question?.paused]);

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

  async function openProfile() {
    setError("");
    try {
      const response = await fetch(`/api/profile/${sessionToken}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load profile.");
      setProfile(data);
      setScreen("profile");
    } catch (profileError) {
      setError(profileError.message);
    }
  }

  function answer(index) {
    if (!answered && screen === "question") {
      setSelectedOption(index);
      socket.emit("game:answer", { optionIndex: index });
    }
  }

  function usePowerUp(type) {
    if (screen === "question" && question?.powerUps) socket.emit("game:power-up", { type });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setScreen("home")} type="button" aria-label="Go to AptiQuiz home">
          <span className="brand-mark">A</span>
          <span>Apti<span>Quiz</span></span>
        </button>
        <button className="league-link" onClick={() => setScreen("league")} type="button">View league <span>↗</span></button>
        {sessionToken && <button className="league-link" onClick={openProfile} type="button">Profile</button>}
        <SoundToggle enabled={soundEnabled} onChange={setSoundEnabled} />
      </header>
      {connection !== "connected" && <div className="connection-banner" role="status">{connection === "failed" ? <>Unable to reconnect. <button onClick={retryConnection} type="button">Retry connection</button></> : <>Connection lost. Reconnecting{reconnectAttempt ? ` (attempt ${reconnectAttempt}/8)` : "…"} </>}</div>}
      <main className="page">
        <ScreenTransition key={screen}>
          {screen === "home" && <Home mode={mode} setMode={setMode} name={name} setName={setName} code={code} setCode={setCode} collegeName={collegeName} setCollegeName={setCollegeName} submit={submit} error={error} loading={loading} />}
          {screen === "lobby" && <Lobby room={room} code={code} name={name} isHost={isHost} error={error} onStart={() => socket.emit("game:start")} />}
          {screen === "question" && question && <Question question={question} seconds={seconds} answered={answered} selectedOption={selectedOption} answer={answer} onPowerUp={usePowerUp} isHost={isHost} />}
          {screen === "reveal" && <Reveal reveal={reveal} />}
          {screen === "leaderboard" && <Leaderboard leaderboard={leaderboard} playerName={name} />}
          {screen === "results" && <Results leaderboard={leaderboard} playerName={name} accuracy={accuracy} averageSpeed={averageSpeed} topics={topics} isHost={isHost} onDashboard={() => socket.emit("host:results")} onHome={() => window.location.reload()} />}
          {screen === "host-results" && <HostResults data={hostResults} onHome={() => window.location.reload()} />}
          {screen === "league" && <League period={leaguePeriod} setPeriod={setLeaguePeriod} college={leagueCollege} setCollege={setLeagueCollege} data={leagueData} loading={leagueLoading} error={error} playerName={name} onHome={() => setScreen("home")} />}
          {screen === "profile" && <Profile data={profile} onHome={() => setScreen("home")} />}
        </ScreenTransition>
      </main>
      <Toast message={error} onDismiss={() => setError("")} />
    </div>
  );
}

function SpectatorApp({ roomCode }) {
  const [view, setView] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const spectatorSocket = io({ autoConnect: true });
    const onJoined = (data) => {
      setView(data);
      setSeconds(Math.ceil((data.question?.remainingMs || 0) / 1000));
      setConnected(true);
    };
    const onUpdate = (data) => {
      setView(data);
      setSeconds(Math.ceil((data.question?.remainingMs || 0) / 1000));
    };
    const onConnect = () => spectatorSocket.emit("spectator:join", { code: roomCode });
    const onError = ({ message }) => setError(message || "This room is not available.");
    const onDisconnect = () => setConnected(false);
    spectatorSocket.on("connect", onConnect);
    spectatorSocket.on("spectator:joined", onJoined);
    spectatorSocket.on("spectator:update", onUpdate);
    spectatorSocket.on("room:error", onError);
    spectatorSocket.on("disconnect", onDisconnect);
    return () => {
      spectatorSocket.disconnect();
      spectatorSocket.off("connect", onConnect);
      spectatorSocket.off("spectator:joined", onJoined);
      spectatorSocket.off("spectator:update", onUpdate);
      spectatorSocket.off("room:error", onError);
      spectatorSocket.off("disconnect", onDisconnect);
    };
  }, [roomCode]);

  useEffect(() => {
    if (view?.state !== "question" || seconds <= 0) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [view?.state, seconds]);

  const question = view?.question;
  const answerCount = question?.answerCount || 0;
  const playerCount = view?.playersOnline || 0;
  const inviteUrl = `${window.location.origin}/?room=${roomCode}`;
  return (
    <div className="app-shell spectator-shell">
      <header className="site-header spectator-header">
        <div className="brand" aria-label="AptiQuiz spectator view"><span className="brand-mark">A</span><span>Apti<span>Quiz</span></span></div>
        <Badge tone="lime"><i className="status-dot" /> {connected ? "Live projector" : "Connecting…"}</Badge>
      </header>
      <main className="spectator-page">
        {error ? <GlassCard className="spectator-error"><h1>Room unavailable</h1><p>{error}</p><Button onClick={() => window.location.reload()} type="button">Try again</Button></GlassCard> : !view ? <GlassCard className="spectator-error"><h1>Connecting to room {roomCode}</h1><p>Waiting for the live game feed…</p></GlassCard> : <>
          <div className="spectator-topbar"><div><span className="eyebrow">LIVE ARENA</span><h1>Room {roomCode}</h1></div><div className="spectator-qr"><QRCodeSVG bgColor="#141d3b" fgColor={colors.ink} level="M" size={92} value={inviteUrl} title={`QR code to join room ${roomCode}`} /><span>Scan to join</span></div></div>
          {view.state === "lobby" && <GlassCard className="spectator-waiting"><span className="spectator-kicker">GET READY</span><strong>Waiting for the host to start</strong><span>{playerCount} player{playerCount === 1 ? "" : "s"} in the room</span></GlassCard>}
          {question && <GlassCard className="spectator-question"><div className="spectator-question-meta"><Badge>{question.topic || "Aptitude"}</Badge><strong>Question {view.questionNumber} <span>/ {view.totalQuestions}</span></strong></div><h2>{question.text}</h2>{question.imageUrl && <img className="question-image" src={question.imageUrl} alt="" />}{view.state === "question" && <><div className={`spectator-countdown ${seconds <= 5 ? "countdown-danger" : ""}`}><strong>{seconds}s</strong><TimerBar max={question.timeLimitMs / 1000} value={seconds} /><span>{answerCount} / {playerCount} answered</span></div><div className="spectator-answer-bar" aria-label={`${answerCount} of ${playerCount} players answered`}><span style={{ width: `${playerCount ? Math.min(100, (answerCount / playerCount) * 100) : 0}%` }} /></div></>}{view.state === "reveal" && <div className="spectator-reveal" role="status">Correct answer: <strong>{question.correctOption}</strong></div>}<div className="spectator-options">{question.options.map((option, index) => <div className={`spectator-option ${index === question.correctIndex ? "spectator-correct" : ""}`} key={`${option}-${index}`}><span aria-hidden="true">{["◆", "●", "▲", "✚"][index] || "◇"}</span><b>{String.fromCharCode(65 + index)}</b><span>{option}</span>{index === question.correctIndex && <strong aria-label="Correct answer">✓</strong>}</div>)}</div></GlassCard>}
          <SpectatorLeaderboard leaderboard={view.leaderboard} />
        </>}
      </main>
    </div>
  );
}

function SpectatorLeaderboard({ leaderboard = [] }) {
  return <GlassCard className="spectator-leaderboard"><div className="spectator-section-title"><span>LIVE LEADERBOARD</span><small>{leaderboard.length} players</small></div><div className="spectator-leaderboard-list">{leaderboard.slice(0, 50).map((player) => <motion.div layout className="spectator-rank-row" key={player.name}><strong>{player.rank}</strong><Avatar name={player.name} /><span>{player.name}</span><b>{player.score.toLocaleString()}</b></motion.div>)}</div></GlassCard>;
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
        <a className="practice-link" href="/practice">✧ Practice with AI</a>
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

function PracticeApp() {
  const [screen, setScreen] = useState("setup");
  const [category, setCategory] = useState("mixed");
  const [total, setTotal] = useState(5);
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const shapes = ["◆", "●", "▲", "✚"];

  async function request(path, body) {
    const response = await fetch(`/api/practice/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Practice request failed.");
    return data;
  }

  async function start() {
    setLoading(true);
    setError("");
    try {
      const started = await request("start", { category, total });
      setSession(started);
      await loadNext(started.sessionId);
    } catch (startError) {
      setError(startError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadNext(sessionId = session?.sessionId) {
    setScreen("loading");
    setLoading(true);
    setError("");
    try {
      const next = await request("next", { sessionId });
      setQuestion(next);
      setSeconds(next.timeLimit);
      setSelected(null);
      setScreen("question");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  async function choose(index) {
    if (selected !== null || !question) return;
    setSelected(index);
    try {
      const result = await request("answer", { sessionId: session.sessionId, questionId: question.questionId, selectedIndex: index });
      setFeedback(result);
      setSession((current) => ({ ...current, level: result.newLevel }));
      setScreen("feedback");
    } catch (answerError) {
      setError(answerError.message);
      setSelected(null);
    }
  }

  useEffect(() => {
    if (screen !== "question" || seconds <= 0) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen, seconds]);

  useEffect(() => {
    if (screen === "question" && seconds === 0 && selected === null) void choose(0);
  }, [screen, seconds, selected]);

  async function continuePractice() {
    if (question.number >= question.total) {
      setLoading(true);
      try {
        const result = await request("finish", { sessionId: session.sessionId });
        setSummary(result);
        setScreen("summary");
      } catch (finishError) {
        setError(finishError.message);
      } finally {
        setLoading(false);
      }
      return;
    }
    await loadNext();
  }

  return (
    <div className="app-shell practice-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Go to AptiQuiz home"><span className="brand-mark">A</span><span>Apti<span>Quiz</span></span></a>
        <Badge tone="cyan">Solo practice</Badge>
      </header>
      <main className="page practice-page">
        {screen === "setup" && <PracticeSetup category={category} setCategory={setCategory} total={total} setTotal={setTotal} start={start} loading={loading} error={error} />}
        {screen === "loading" && <PracticeLoading />}
        {screen === "question" && question && <PracticeQuestion question={question} seconds={seconds} selected={selected} choose={choose} shapes={shapes} />}
        {screen === "feedback" && feedback && <PracticeFeedback feedback={feedback} question={question} onNext={continuePractice} loading={loading} />}
        {screen === "summary" && summary && <PracticeSummary summary={summary} onHome={() => { window.location.href = "/"; }} />}
        {error && screen !== "setup" && <GlassCard className="practice-error" role="alert"><strong>We hit a practice hiccup.</strong><span>{error}</span><Button onClick={() => loadNext()} type="button">Retry</Button></GlassCard>}
      </main>
    </div>
  );
}

function PracticeLoading() {
  return <section className="practice-question-panel" aria-live="polite" aria-busy="true"><div className="practice-skeleton-meta" /><GlassCard className="question-card practice-skeleton-card"><span /><span /><span /></GlassCard><div className="practice-answer-grid">{[1, 2, 3, 4].map((item) => <div className="practice-skeleton-answer" key={item} />)}</div><p className="practice-loading-label">Preparing your next question…</p></section>;
}

function PracticeSetup({ category, setCategory, total, setTotal, start, loading, error }) {
  return <section className="practice-layout">
    <div className="section-heading"><div><div className="eyebrow">AI PRACTICE COACH</div><h1>Sharpen your edge.</h1><p>Fresh solo questions adapt to your level as you play. No room, no leaderboard pressure.</p></div><Badge tone="lime">Level 5 starting point</Badge></div>
    <GlassCard className="practice-card">
      <label className="practice-label">Category
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Practice category">
          <option value="mixed">Mixed</option><option value="quantitative">Quantitative</option><option value="logical">Logical</option><option value="verbal">Verbal</option><option value="data-interpretation">Data interpretation</option>
        </select>
      </label>
      <fieldset className="practice-length"><legend className="practice-label">Session length</legend><div>{[5, 10, 15].map((value) => <label key={value}><input checked={total === value} name="practice-length" onChange={() => setTotal(value)} type="radio" />{value} questions</label>)}</div></fieldset>
      <details className="scoring-rules practice-rules"><summary><span>How levels work</span><span aria-hidden="true">＋</span></summary><div className="rules-content"><p>Start at level 5. A fast correct answer adds <strong>+0.6</strong>, a slow correct answer adds <strong>+0.3</strong>, and a wrong or late answer subtracts <strong>0.5</strong>. Levels stay between 1 and 10.</p><p>Question timers range from 45 seconds at level 1 to 90 seconds at level 10.</p></div></details>
      <p className="ai-notice"><Badge tone="violet">AI-generated</Badge> Some questions and explanations are written by AI. Fallback questions keep practice available if AI is unavailable.</p>
      {error && <p className="error" role="alert">! {error}</p>}
      <Button disabled={loading} onClick={start} type="button">{loading ? "Preparing your coach…" : "Start practice →"}</Button>
    </GlassCard>
  </section>;
}

function PracticeQuestion({ question, seconds, selected, choose, shapes }) {
  return <section className="practice-question-panel">
    <div className="question-meta"><span>QUESTION {question.number} <b>/ {question.total}</b></span><Badge>{question.topic}</Badge>{question.aiGenerated && <Badge tone="violet">AI-generated</Badge>}</div>
    <div className="countdown-row"><strong aria-label={`${seconds} seconds remaining`}>{seconds}s</strong><TimerBar max={question.timeLimit} value={seconds} /><span className="countdown-label">{question.timeLimit}s limit</span></div>
    <GlassCard className="question-card"><h1 className="question-title">{question.text}</h1></GlassCard>
    <div className="practice-answer-grid" role="group" aria-label="Answer options">{question.options.map((option, index) => <button className={`practice-answer ${selected === index ? "selected" : ""}`} disabled={selected !== null} key={option} onClick={() => choose(index)} type="button"><strong>{String.fromCharCode(65 + index)}</strong><span className="shape-icon" aria-hidden="true">{shapes[index]}</span><span>{option}</span></button>)}</div>
  </section>;
}

function PracticeFeedback({ feedback, question, onNext, loading }) {
  const timedOut = feedback.timeTaken >= question.timeLimit && !feedback.correct;
  return <section className="practice-feedback">
    <GlassCard className={`feedback-card ${feedback.correct ? "is-correct" : "is-wrong"}`}><div className="feedback-result" role="status"><span aria-hidden="true">{feedback.correct ? "✓" : "✕"}</span><div><h1>{feedback.correct ? "Correct!" : timedOut ? "Time’s up" : "Not quite"}</h1><p>{feedback.correct ? "Nice work under pressure." : "Use the explanation to spot the pattern next time."}</p></div></div><p><strong>Correct answer:</strong> {question.options[feedback.correctIndex]}</p><p><strong>Time taken:</strong> {feedback.timeTaken}s</p><p className="level-change">Level {feedback.previousLevel.toFixed(1)} → {feedback.newLevel.toFixed(1)}</p></GlassCard>
    <GlassCard className="explanation-card"><div className="practice-card-heading"><h2>How it is solved</h2>{feedback.aiGenerated && <Badge tone="violet">AI-generated</Badge>}</div><ol>{feedback.explanation.map((step) => <li key={step}>{step}</li>)}</ol><Button disabled={loading} onClick={onNext} type="button">Next question →</Button></GlassCard>
  </section>;
}

function PracticeSummary({ summary, onHome }) {
  return <section className="practice-summary"><div className="section-heading"><div><div className="eyebrow">SESSION COMPLETE</div><h1>Keep the momentum.</h1><p>Your coach has turned this round into a focused next step.</p></div><Badge tone="lime">Level {summary.finalLevel.toFixed(1)}</Badge></div><div className="practice-summary-grid"><GlassCard><span className="label">ACCURACY</span><strong>{summary.accuracy}%</strong></GlassCard><GlassCard><span className="label">AVERAGE TIME</span><strong>{summary.averageTime}s</strong></GlassCard><GlassCard><span className="label">FINAL LEVEL</span><strong>{summary.finalLevel.toFixed(1)}</strong></GlassCard></div><GlassCard className="practice-strengths"><h2>Topic-wise strengths</h2>{summary.topicStrengths.length ? summary.topicStrengths.map((item) => <div className="strength-row" key={item.topic}><span>{item.topic}</span><span className="strength-bar"><i style={{ width: `${item.accuracy}%` }} /></span><strong>{item.accuracy}%</strong></div>) : <p>No answers were recorded.</p>}</GlassCard><GlassCard className="practice-tips"><h2>Study tips</h2><ul>{summary.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul><Button onClick={onHome} type="button">Back to home</Button></GlassCard></section>;
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
  return <details className="scoring-rules"><summary><span><span className="rules-icon" aria-hidden="true">✦</span> How scoring works</span><span aria-hidden="true">＋</span></summary><div className="rules-content"><div><strong>1000</strong><span>Base points</span></div><div><strong>+ speed</strong><span>Faster answers score more</span></div><div><strong>0</strong><span>Incorrect answers</span></div><div><strong>2×</strong><span>Double Points: next correct answer</span></div><div><strong>50-50</strong><span>Removes two wrong options once</span></div></div></details>;
}

function Question({ question, seconds, answered, selectedOption, answer, onPowerUp, isHost }) {
  const shapes = ["◆", "●", "▲", "✚"];
  return <section className="game-panel question-screen">
    <div className="question-meta"><span>QUESTION {question.questionNumber} <b>/ {question.totalQuestions}</b></span><span className="streak-indicator" aria-label={`${question.streak || 0} consecutive correct answers`}>{question.streak > 0 ? `🔥 ${question.streak}` : "Start a streak"}</span><Badge>{question.topic || "Aptitude"}</Badge></div>
    <div className={`countdown-row ${seconds <= 5 ? "countdown-danger" : seconds <= 10 ? "countdown-warning" : ""}`}><strong aria-label={`${seconds} seconds remaining`}>{question.paused ? "Ⅱ" : `${seconds}s`}</strong><TimerBar max={question.timeLimitMs / 1000} value={seconds} /><span className="countdown-label">{question.paused ? "Paused by host" : "Time left"}</span></div>
    {isHost && <div className="host-control-row" aria-label="Host question controls"><Button variant="secondary" onClick={() => socket.emit(question.paused ? "host:resume" : "host:pause")} type="button">{question.paused ? "Resume" : "Pause"}</Button><Button variant="secondary" onClick={() => socket.emit("host:add-time", { seconds: 10 })} type="button">+10 seconds</Button><Button variant="secondary" onClick={() => socket.emit("game:skip")} type="button">Skip</Button></div>}
    <GlassCard className="question-card"><h1 className="question-title">{question.text}</h1>{question.imageUrl && <img className="question-image" src={question.imageUrl} alt="" />}{question.tableJson && <QuestionTable data={question.tableJson} />}</GlassCard>
    <div className="power-up-row" aria-label="Power-ups">
      <button className={`power-up-button ${question.powerUps?.doublePointsArmed ? "power-up-active" : ""}`} disabled={answered || seconds === 0 || !question.powerUps?.doublePointsAvailable} onClick={() => onPowerUp("doublePoints")} type="button" aria-label={question.powerUps?.doublePointsArmed ? "Double Points armed" : "Use Double Points, one use per game"}>
        <span aria-hidden="true">2×</span><span>Double Points</span><small>{question.powerUps?.doublePointsArmed ? "Armed" : question.powerUps?.doublePointsAvailable ? "1 use" : "Used"}</small>
      </button>
      <button className="power-up-button" disabled={answered || seconds === 0 || !question.powerUps?.fiftyFiftyAvailable} onClick={() => onPowerUp("fiftyFifty")} type="button" aria-label="Use 50-50 to remove two wrong options">
        <span aria-hidden="true">½</span><span>50-50</span><small>{question.powerUps?.fiftyFiftyAvailable ? "1 use" : "Used"}</small>
      </button>
    </div>
    <div className="options-grid">{question.options.map((option, index) => question.removedOptionIndices?.includes(index) ? <div className="option-button option-removed" aria-label={`Option ${String.fromCharCode(65 + index)} removed by 50-50`} key={`${option}-${index}`}><span className={`option-shape shape-${index}`} aria-hidden="true">×</span><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">Removed</span></div> : <motion.button whileTap={answered ? undefined : { scale: 0.97, y: 3 }} aria-label={`Option ${String.fromCharCode(65 + index)}: ${option}`} className={`option-button option-${index} ${selectedOption === index ? "selected" : ""}`} disabled={answered || seconds === 0} key={`${option}-${index}`} onClick={() => answer(index)} type="button"><span className={`option-shape shape-${index}`} aria-hidden="true">{shapes[index] || "◇"}</span><span className="option-key">{String.fromCharCode(65 + index)}</span><span className="option-copy">{option}</span></motion.button>)}</div>
    {answered && <div className="answer-confirmation" role="status">✓ Answer locked in. Nice work.</div>}
  </section>;
}

function Reveal({ reveal }) {
  const selectedIndex = reveal?.answer?.selectedIndex;
  const correctIndex = reveal?.correctShuffledIndex;
  return <section className="reveal-panel question-screen"><div className="result-icon">✓</div><div className="eyebrow">Answer revealed</div><h1>{reveal?.correctOption || "Round complete"}</h1><p className="reveal-copy">The correct answer is highlighted. Here’s how you did this round.</p>{reveal?.explanation && <GlassCard className="explanation-card"><strong>Explanation</strong><p>{reveal.explanation}</p></GlassCard>}{reveal?.options && <div className="reveal-options">{reveal.options.map((option, index) => <div className={`reveal-option ${index === correctIndex ? "reveal-correct" : ""} ${index === selectedIndex && index !== correctIndex ? "reveal-wrong" : ""}`} key={`${option}-${index}`}><span className="option-shape" aria-hidden="true">{["◆", "●", "▲", "✚"][index] || "◇"}</span><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option}</span><strong aria-label={index === correctIndex ? "Correct answer" : index === selectedIndex ? "Your incorrect answer" : ""}>{index === correctIndex ? "✓" : index === selectedIndex ? "✕" : ""}</strong></div>)}</div>}{reveal?.answer?.points > 0 && <motion.div className="points-flyup" initial={{ opacity: 0, y: 22, scale: .8 }} animate={{ opacity: 1, y: -4, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>+{reveal.answer.points}</motion.div>}<div className="reveal-stats"><div><span>Your points</span><strong>{reveal?.answer?.points ?? 0}</strong></div><div><span>Result</span><strong className={reveal?.answer?.isCorrect ? "correct-text" : "muted-text"}>{reveal?.answer?.isCorrect ? "Correct" : "Keep going"}</strong></div></div></section>;
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
  const bestTopic = topics.slice().sort((left, right) => right.accuracy - left.accuracy)[0];
  const badges = [
    accuracy === 100 ? "Perfect Round" : null,
    averageSpeed > 0 && averageSpeed <= 3 ? "Speed Demon" : null,
    player?.rank === 1 ? "Top of the board" : null
  ].filter(Boolean);
  const summary = `${player?.name || "The player"} scored ${player?.score || 0} points with ${accuracy}% accuracy and an average answer speed of ${averageSpeed} seconds. Strongest topics: ${topics.map((topic) => `${topic.topic} at ${topic.accuracy}%`).join(", ") || "Keep playing to reveal your strengths"}.`;
  return <section className="results-panel"><div className="eyebrow">Game complete</div><h1>That’s a wrap.</h1><p className="results-copy">A sharp finish. Here’s your performance snapshot.</p>{player?.badges?.length > 0 && <div className="badge-list" aria-label="Earned badges">{player.badges.map((badge) => <Badge tone="lime" key={badge}>✦ {badge}</Badge>)}</div>}<Suspense fallback={<div className="podium-2d podium-loading" aria-label="Loading podium" />}><Podium players={leaderboard} /></Suspense><div className="metrics"><div><strong>{player?.score || 0}</strong><span>Total points</span></div><div><strong>{accuracy}%</strong><span>Accuracy</span></div><div><strong>{averageSpeed}s</strong><span>Avg. speed</span></div></div><div className="chart-card"><div className="card-top"><div><span className="label">TOPIC STRENGTHS</span><h2>Where you shine</h2></div><span className="chart-legend"><i /> Accuracy</span></div><div className="chart-wrap"><Suspense fallback={<div className="chart-loading">Loading chart…</div>}><TopicAccuracyChart topics={topics} /></Suspense><p className="sr-only" role="status">{summary}</p></div></div><ShareCardButton player={player} accuracy={accuracy} averageSpeed={averageSpeed} bestTopic={bestTopic} badges={badges} />{isHost && <button className="primary-button" onClick={onDashboard} type="button">Open host dashboard →</button>}<button className="secondary-button" onClick={onHome} type="button">Back to home</button></section>;
}

function ShareCardButton({ player, accuracy, averageSpeed, bestTopic, badges }) {
  const [status, setStatus] = useState("");
  const createCard = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser cannot generate an image.");
    const background = context.createLinearGradient(0, 0, 1200, 630);
    background.addColorStop(0, "#11163c");
    background.addColorStop(1, "#071b2b");
    context.fillStyle = background;
    context.fillRect(0, 0, 1200, 630);
    context.fillStyle = "rgba(50,214,255,.14)";
    context.beginPath();
    context.arc(980, 40, 330, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(50,214,255,.25)";
    context.lineWidth = 2;
    context.strokeRect(42, 42, 1116, 546);
    context.fillStyle = "#32d6ff";
    context.font = "700 26px Arial";
    context.fillText("APTIQUIZ", 78, 102);
    context.fillStyle = "#f5f7ff";
    context.font = "700 58px Arial";
    context.fillText("Game complete", 78, 190);
    context.font = "700 42px Arial";
    context.fillText((player?.name || "Player").slice(0, 28), 78, 255);
    context.fillStyle = "#9aa8c7";
    context.font = "600 22px Arial";
    context.fillText("Rank", 78, 342);
    context.fillText("Score", 310, 342);
    context.fillText("Accuracy", 550, 342);
    context.fillText("Best topic", 790, 342);
    context.fillStyle = "#c8f66b";
    context.font = "700 42px Arial";
    context.fillText(`#${player?.rank || "—"}`, 78, 392);
    context.fillText(`${player?.score || 0}`, 310, 392);
    context.fillText(`${accuracy}%`, 550, 392);
    context.font = "700 28px Arial";
    context.fillText(bestTopic?.topic?.slice(0, 16) || "Keep playing", 790, 392);
    context.fillStyle = "#f5f7ff";
    context.font = "600 20px Arial";
    context.fillText(badges.length ? badges.join("  •  ") : "AptiQuiz arena finisher", 78, 490);
    context.fillStyle = "#7180a2";
    context.font = "500 18px Arial";
    context.fillText(`Average speed ${averageSpeed}s  •  aptiquiz`, 78, 535);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not export the result card.")), "image/png"));
  };
  const share = async () => {
    setStatus("Preparing card…");
    try {
      const blob = await createCard();
      const file = new File([blob], "aptiquiz-result.png", { type: "image/png" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: "My AptiQuiz result", text: `I scored ${player?.score || 0} points in AptiQuiz!`, files: [file] });
        setStatus("Shared.");
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "aptiquiz-result.png";
        link.click();
        URL.revokeObjectURL(url);
        setStatus("PNG downloaded.");
      }
    } catch (shareError) {
      if (shareError.name !== "AbortError") setStatus(shareError.message);
      else setStatus("");
    }
  };
  return <div className="share-card-action"><button className="secondary-button" onClick={share} type="button">Share result card ↗</button>{status && <span className="csv-status" role="status">{status}</span>}</div>;
}

function Profile({ data, onHome }) {
  if (!data) return <section className="results-panel"><p className="error">Profile is not available yet.</p><button className="secondary-button" onClick={onHome} type="button">Back to home</button></section>;
  const topics = data.topics || [];
  const strongest = topics[0];
  const weakest = topics.length > 1 ? topics[topics.length - 1] : null;
  const ranked = data.globalRank != null;
  return <section className="profile-panel">
    <div className="section-heading"><div><div className="eyebrow">Player profile</div><h1>{data.name}</h1><p>{data.college}</p></div><button className="back-link" onClick={onHome} type="button">← Home</button></div>
    <div className="profile-tier"><Badge tone="violet">🏅 {data.tier} tier</Badge>{ranked && <span className="tier-note">Top {Math.max(1, Math.round((data.globalRank / (data.totalPlayers || 1)) * 100))}% of {data.totalPlayers} players</span>}</div>
    <div className="rank-cards">
      <GlassCard className="rank-card"><span className="rank-label">Global rank</span><strong>{ranked ? `#${data.globalRank}` : "—"}</strong><span className="rank-sub">{ranked ? `of ${data.totalPlayers} players` : "Play a live game to get ranked"}</span></GlassCard>
      <GlassCard className="rank-card"><span className="rank-label">College rank</span><strong>{data.collegeRank != null ? `#${data.collegeRank}` : "—"}</strong><span className="rank-sub">{data.collegeRank != null ? `of ${data.collegePlayers} in ${data.college}` : "No college ranking yet"}</span></GlassCard>
    </div>
    <GlassCard className="profile-card">
      <div className="metrics">
        <div><strong>{data.points ?? 0}</strong><span>Total points</span></div>
        <div><strong>{data.totalGames}</strong><span>Games</span></div>
        <div><strong>{data.accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>{data.averageTime ? `${data.averageTime}s` : "—"}</strong><span>Avg. speed</span></div>
      </div>
      <h2>Performance analysis</h2>
      {topics.length ? <div className="topic-analysis">
        {topics.map((topic) => <div className="topic-row" key={topic.topic}><span className="topic-name">{topic.topic}</span><div className="topic-bar" role="img" aria-label={`${topic.topic} accuracy ${topic.accuracy}%`}><i style={{ width: `${Math.max(4, Math.min(100, topic.accuracy))}%` }} /></div><b>{topic.accuracy}%</b></div>)}
      </div> : <p className="empty-state">Answer questions in a live game to unlock your topic analysis.</p>}
      <div className="analysis-summary">
        {strongest && <p><b>Strongest:</b> {strongest.topic} at {strongest.accuracy}% — keep leaning on this.</p>}
        {weakest && <p><b>Needs work:</b> {weakest.topic} at {weakest.accuracy}% — practise a few extra here.</p>}
      </div>
      <h2>Badges</h2>
      {data.badges.length ? <div className="badge-list">{data.badges.map((badge) => <Badge tone="lime" key={badge}>✦ {badge}</Badge>)}</div> : <p className="empty-state">Play more games to earn badges.</p>}
    </GlassCard>
  </section>;
}

function HostResults({ data, onHome }) {
  const [uploadStatus, setUploadStatus] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("mixed");
  const [aiCount, setAiCount] = useState(5);
  const [aiBusy, setAiBusy] = useState(false);
  if (!data) return <section className="results-panel"><p className="error">Results are not available.</p></section>;
  const generateWithAi = async (event) => {
    event.preventDefault();
    if (!data.questionSetId || !aiTopic.trim() || aiBusy) return;
    setAiBusy(true);
    setUploadStatus(`Generating ${aiCount} "${aiTopic.trim()}" questions with AI…`);
    try {
      const response = await fetch(`/api/question-sets/${data.questionSetId}/questions/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiTopic.trim(),
          count: aiCount,
          ...(aiDifficulty === "mixed" ? {} : { difficulty: aiDifficulty })
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI generation failed.");
      setUploadStatus(`${result.generated} AI questions added to "${aiTopic.trim()}". New games will use them.`);
    } catch (generateError) {
      setUploadStatus(generateError.message);
    } finally {
      setAiBusy(false);
    }
  };
  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !data.questionSetId) return;
    setUploadStatus("Uploading…");
    try {
      const response = await fetch(`/api/question-sets/${data.questionSetId}/questions/csv`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text()
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors ? result.errors.map((item) => `Row ${item.line}: ${item.messages.join(", ")}`).join(" ") : result.error);
      setUploadStatus(`${result.imported} questions imported. New games will use them.`);
    } catch (uploadError) {
      setUploadStatus(uploadError.message);
    }
    event.target.value = "";
  };
  const downloadTemplate = () => {
    const template = "text,option_a,option_b,option_c,option_d,correct_index,topic,difficulty,explanation,image_url\n\"What is 2 + 2?\",3,4,5,6,1,quantitative,easy,\"The sum of two and two is four.\",";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([template], { type: "text/csv" }));
    link.download = "aptiquiz-question-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
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
  return <section className="host-results-panel"><div className="section-heading"><div><div className="eyebrow">Host dashboard · {data.roomCode}</div><h1>Results, at a glance.</h1><p>See where the room found its edge and where it got stuck.</p></div><button className="back-link" onClick={onHome} type="button">← Home</button></div><div className="dashboard-actions"><button className="primary-button" onClick={downloadCsv} type="button">Download all results (CSV)</button>{data.questionSetId && <><form className="ai-generate" onSubmit={generateWithAi}><label className="ai-field">Topic<input onChange={(event) => setAiTopic(event.target.value)} placeholder="e.g. Profit &amp; Loss" required value={aiTopic} /></label><label className="ai-field">Difficulty<select onChange={(event) => setAiDifficulty(event.target.value)} value={aiDifficulty}><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label className="ai-field">Count<input max="10" min="1" onChange={(event) => setAiCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} type="number" value={aiCount} /></label><button className="primary-button" disabled={aiBusy || !aiTopic.trim()} type="submit">{aiBusy ? "Generating…" : "Generate with AI"}</button></form><button className="secondary-button" onClick={downloadTemplate} type="button">Download question CSV template</button><label className="csv-upload">Upload questions<input accept=".csv,text/csv" onChange={importCsv} type="file" /></label><span className="csv-status" role="status">{uploadStatus}</span></>}</div><div className="dashboard-grid"><div className="chart-card"><span className="label">PER-QUESTION ACCURACY</span><h2>How the room performed</h2><div className="dashboard-table">{data.questions.map((item) => <div className="dashboard-row" key={item.questionId}><span><b>Q{item.questionNumber}</b> {item.text}</span><strong>{item.percentageCorrect}%<small>{item.correctCount}/{item.missedCount + item.answerCount} correct</small></strong></div>)}</div></div><div className="chart-card"><span className="label">MOST MISSED</span><h2>Needs another look</h2><div className="dashboard-table">{data.mostMissed.map((item) => <div className="dashboard-row" key={item.questionId}><span><b>Q{item.questionNumber}</b> {item.text}</span><strong>{item.missedCount}<small>missed</small></strong></div>)}</div></div><div className="chart-card topic-dashboard"><span className="label">TOPIC ACCURACY</span><h2>Strength by topic</h2><div className="chart-wrap"><ResponsiveContainer height={230} width="100%"><BarChart data={data.topics} layout="vertical" margin={{ left: 14, right: 18 }}><CartesianGrid horizontal={false} stroke="#e5e1d9" /><XAxis domain={[0, 100]} hide type="number" /><YAxis axisLine={false} dataKey="topic" tick={{ fill: colors.muted, fontSize: 12 }} tickLine={false} type="category" width={110} /><Tooltip formatter={(value) => [`${value}%`, "Accuracy"]} /><Bar dataKey="accuracy" fill={colors.coral} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div></div></section>;
}

function League({ period, setPeriod, college, setCollege, data, loading, error, playerName, onHome }) {
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
      <div className="league-card"><div className="card-top"><div><span className="label">TOP PLAYERS</span><h2>Sharpest minds</h2></div><span className="trophy">♛</span></div><div className="league-table">{data.players.length ? data.players.map((player, index) => <div className={`league-row ${playerName && player.name === playerName ? "current-player" : ""}`} key={`${player.name}-${player.college}`}><strong>{index + 1}</strong><span className="avatar">{player.name.charAt(0)}</span><span className="league-name">{player.name}{playerName && player.name === playerName && <small className="you-label">YOU</small>}<small>{player.college} · {player.games_played} games</small></span><b>{player.points}<small> pts</small></b></div>) : <p className="empty-state">No scores for this period yet.</p>}</div></div>
      <div className="league-card"><div className="card-top"><div><span className="label">TOP COLLEGES</span><h2>Campus cup</h2></div><span className="trophy">✦</span></div><div className="league-table">{data.colleges.length ? data.colleges.map((item, index) => <div className="league-row" key={item.name}><strong>{index + 1}</strong><span className="college-icon">◎</span><span className="league-name">{item.name}<small>{item.players} players · {item.accuracy}% accuracy</small></span><b>{item.points}<small> pts</small></b></div>) : <p className="empty-state">No college scores yet.</p>}</div></div>
    </div>
  </section>;
}
