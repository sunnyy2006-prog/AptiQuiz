import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const socket = io();
const STORAGE = {
  code: "aptiquiz.roomCode",
  name: "aptiquiz.playerName",
  token: "aptiquiz.sessionToken"
};

const colors = {
  ink: "#172033",
  muted: "#5e6b80",
  teal: "#007c83",
  coral: "#d95d39",
  gold: "#d39b24"
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
  const [leaguePeriod, setLeaguePeriod] = useState("all");
  const [leagueCollege, setLeagueCollege] = useState("");
  const [leagueData, setLeagueData] = useState({ players: [], colleges: [] });
  const [hostResults, setHostResults] = useState(null);

  useEffect(() => {
    if (screen !== "league") return;
    const query = new URLSearchParams({ period: leaguePeriod });
    if (leagueCollege) query.set("collegeId", leagueCollege);
    fetch(`/api/league?${query}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the league.");
        return response.json();
      })
      .then(setLeagueData)
      .catch((loadError) => setError(loadError.message));
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
        setAnswered(true);
        setAnswers((current) => [...current, { ...result, topic: question?.topic }]);
      } else setError(result.reason);
    };
    const onHostResults = (data) => {
      setHostResults(data);
      setScreen("host-results");
    };
    const onError = ({ message }) => {
      setError(message);
      if (/not found|closed|token is not valid/i.test(message)) {
        localStorage.removeItem(STORAGE.code);
        localStorage.removeItem(STORAGE.token);
      }
    };
    const onConnect = () => {
      const storedCode = localStorage.getItem(STORAGE.code);
      const token = localStorage.getItem(STORAGE.token);
      const storedName = localStorage.getItem(STORAGE.name);
      if (storedCode && token) socket.emit("room:join", { code: storedCode, sessionToken: token, playerName: storedName });
    };

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
    };
  }, [question?.topic, room?.state]);

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
    localStorage.setItem(STORAGE.name, name);
    if (mode === "create") {
      socket.emit("room:create", { playerName: name, collegeName: collegeName || undefined });
    } else {
      socket.emit("room:join", { code: code.toUpperCase(), playerName: name, sessionToken: localStorage.getItem(STORAGE.code) === code.toUpperCase() ? sessionToken : undefined });
    }
  }

  function answer(index) {
    if (!answered && screen === "question") socket.emit("game:answer", { optionIndex: index });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setScreen("home")} type="button" aria-label="Go to AptiQuiz home">
          <span className="brand-mark">A</span>
          <span>Apti<span>Quiz</span></span>
        </button>
        <button className="league-link" onClick={() => setScreen("league")} type="button">View league <span>↗</span></button>
      </header>
      <main className="page">
        {screen === "home" && <Home mode={mode} setMode={setMode} name={name} setName={setName} code={code} setCode={setCode} collegeName={collegeName} setCollegeName={setCollegeName} submit={submit} error={error} />}
        {screen === "lobby" && <Lobby room={room} code={code} name={name} isHost={isHost} error={error} onStart={() => socket.emit("game:start")} />}
        {screen === "question" && question && <Question question={question} seconds={seconds} answered={answered} answer={answer} />}
        {screen === "reveal" && <Reveal reveal={reveal} />}
        {screen === "leaderboard" && <Leaderboard leaderboard={leaderboard} />}
        {screen === "results" && <Results leaderboard={leaderboard} accuracy={accuracy} averageSpeed={averageSpeed} topics={topics} isHost={isHost} onDashboard={() => socket.emit("host:results")} onHome={() => window.location.reload()} />}
        {screen === "host-results" && <HostResults data={hostResults} onHome={() => window.location.reload()} />}
        {screen === "league" && <League period={leaguePeriod} setPeriod={setLeaguePeriod} college={leagueCollege} setCollege={setLeagueCollege} data={leagueData} error={error} onHome={() => setScreen("home")} />}
      </main>
    </div>
  );
}

function Home({ mode, setMode, name, setName, code, setCode, collegeName, setCollegeName, submit, error }) {
  return (
    <section className="hero-grid">
      <div className="hero-copy">
        <div className="eyebrow">Fast minds. One room.</div>
        <h1>Make every answer <em>count.</em></h1>
        <p>Challenge your crew with live aptitude rounds, instant reveals, and a leaderboard that keeps everyone moving.</p>
        <div className="trust-row"><span>⚡ Real-time play</span><span>♧ Up to 50 players</span><span>◉ No sign-up</span></div>
      </div>
      <form className="join-card" onSubmit={submit}>
        <div className="segmented" role="tablist" aria-label="Room action">
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")} role="tab" type="button">Join a room</button>
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} role="tab" type="button">Create room</button>
        </div>
        <h2>{mode === "create" ? "Start a challenge" : "Ready when you are."}</h2>
        <p className="card-note">{mode === "create" ? "You’ll be the host. Invite your team with a room code." : "Enter the code your host shared with you."}</p>
        <label>Your name<input autoComplete="nickname" maxLength="40" onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya" required value={name} /></label>
        {mode === "create" && <label>College <span className="optional-label">(optional)</span><input maxLength="120" onChange={(event) => setCollegeName(event.target.value)} placeholder="e.g. Delhi University" value={collegeName} /></label>}
        {mode === "join" && <label>Room code<input aria-describedby="code-help" autoCapitalize="characters" maxLength="5" onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABCDE" required value={code} /><small id="code-help">5 characters, shown by your host</small></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary-button" type="submit">{mode === "create" ? "Create room →" : "Join room →"}</button>
        <p className="privacy-note">Your name is only visible to players in this room.</p>
      </form>
    </section>
  );
}

function Lobby({ room, code, name, isHost, error, onStart }) {
  const players = room?.players || [];
  const inviteUrl = `${window.location.origin}/?room=${code}`;
  return (
    <section className="lobby-layout">
      <div className="section-heading"><div><div className="eyebrow">Room lobby</div><h1>Gather your team.</h1><p>Everyone’s here? The host can start the first round.</p></div><span className="status-badge"><i /> Waiting</span></div>
      <div className="lobby-grid">
        <div className="code-card"><div><span className="label">ROOM CODE</span><strong>{code}</strong><button className="copy-button" onClick={() => navigator.clipboard?.writeText(code)} type="button">Copy code</button></div><QRCodeSVG bgColor="#fffdf8" fgColor={colors.ink} level="M" size={112} value={inviteUrl} title="QR code to join this room" /></div>
        <div className="players-card"><div className="card-top"><div><span className="label">PLAYERS</span><h2>{players.length}<small> / 50</small></h2></div><span className="you-badge">You: {name}</span></div><ul className="player-list">{players.map((player, index) => <li className="player-row" key={`${player.name}-${index}`}><span className="avatar">{player.name?.charAt(0).toUpperCase()}</span><span>{player.name}</span>{index === 0 && <span className="host-label">HOST</span>}<span className={player.connected ? "online-dot" : "offline-dot"} /> </li>)}</ul>{error && <p className="error" role="alert">{error}</p>}{isHost ? <button className="primary-button" disabled={players.length < 1} onClick={onStart} type="button">Start game <span>→</span></button> : <p className="waiting-message"><span className="pulse-dot" /> Waiting for the host to start…</p>}</div>
      </div>
    </section>
  );
}

function Question({ question, seconds, answered, answer }) {
  const progress = Math.max(0, Math.min(100, (seconds / (question.timeLimitMs / 1000)) * 100));
  return <section className="game-panel"><div className="question-meta"><span>QUESTION {question.questionNumber} <b>/ {question.totalQuestions}</b></span><span className="topic-chip">{question.topic || "Aptitude"}</span></div><div className="countdown-row"><strong>{seconds}s</strong><div className="countdown-track"><div style={{ width: `${progress}%` }} /></div><span>Time left</span></div><h1 className="question-title">{question.text}</h1><div className="options-grid">{question.options.map((option, index) => <button aria-label={`Option ${String.fromCharCode(65 + index)}: ${option}`} className={`option-button option-${index}`} disabled={answered || seconds === 0} key={`${option}-${index}`} onClick={() => answer(index)} type="button"><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option}</span></button>)}</div>{answered && <div className="answer-confirmation" role="status">Answer locked in. Nice work.</div>}</section>;
}

function Reveal({ reveal }) {
  return <section className="reveal-panel"><div className="result-icon">✓</div><div className="eyebrow">Answer revealed</div><h1>{reveal?.correctOption || "Round complete"}</h1><p className="reveal-copy">The correct answer is highlighted. Here’s how you did this round.</p><div className="reveal-stats"><div><span>Your points</span><strong>{reveal?.answer?.points ?? 0}</strong></div><div><span>Result</span><strong className={reveal?.answer?.isCorrect ? "correct-text" : "muted-text"}>{reveal?.answer?.isCorrect ? "Correct" : "Keep going"}</strong></div></div></section>;
}

function Leaderboard({ leaderboard }) {
  return <section className="leaderboard-panel"><div className="section-heading"><div><div className="eyebrow">Current standings</div><h1>Leaderboard</h1><p>Every point changes the game.</p></div><span className="trophy">♛</span></div><div className="leaderboard-list">{leaderboard.map((player) => <div className={`rank-row rank-${player.rank}`} key={player.name}><strong>{player.rank}</strong><span className="rank-arrow">{player.rankChange === "climbed" ? "↑" : player.rankChange === "dropped" ? "↓" : "—"}</span><span className="avatar">{player.name?.charAt(0)}</span><span className="rank-name">{player.name}</span><span className="rank-score">{player.score}<small> pts</small></span></div>)}</div></section>;
}

function Results({ leaderboard, accuracy, averageSpeed, topics, isHost, onDashboard, onHome }) {
  return <section className="results-panel"><div className="eyebrow">Game complete</div><h1>That’s a wrap.</h1><p className="results-copy">A sharp finish. Here’s your performance snapshot.</p><div className="metrics"><div><strong>{leaderboard[0]?.score || 0}</strong><span>Total points</span></div><div><strong>{accuracy}%</strong><span>Accuracy</span></div><div><strong>{averageSpeed}s</strong><span>Avg. speed</span></div></div><div className="chart-card"><div className="card-top"><div><span className="label">TOPIC STRENGTHS</span><h2>Where you shine</h2></div><span className="chart-legend"><i /> Accuracy</span></div><div className="chart-wrap"><ResponsiveContainer height={220} width="100%"><BarChart data={topics.length ? topics : [{ topic: "Play more", accuracy: 0 }]} layout="vertical" margin={{ left: 14, right: 18 }}><CartesianGrid horizontal={false} stroke="#e5e1d9" /><XAxis domain={[0, 100]} hide type="number" /><YAxis axisLine={false} dataKey="topic" tick={{ fill: colors.muted, fontSize: 12 }} tickLine={false} type="category" width={110} /><Tooltip cursor={{ fill: "#f4f1eb" }} formatter={(value) => [`${value}%`, "Accuracy"]} /><Bar dataKey="accuracy" fill={colors.teal} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div>{isHost && <button className="primary-button" onClick={onDashboard} type="button">Open host dashboard →</button>}<button className="secondary-button" onClick={onHome} type="button">Back to home</button></section>;
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

function League({ period, setPeriod, college, setCollege, data, error, onHome }) {
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
    {error && <p className="error" role="alert">{error}</p>}
    <div className="league-grid">
      <div className="league-card"><div className="card-top"><div><span className="label">TOP PLAYERS</span><h2>Sharpest minds</h2></div><span className="trophy">♛</span></div><div className="league-table">{data.players.length ? data.players.map((player, index) => <div className="league-row" key={`${player.name}-${player.college}`}><strong>{index + 1}</strong><span className="avatar">{player.name.charAt(0)}</span><span className="league-name">{player.name}<small>{player.college} · {player.games_played} games</small></span><b>{player.points}<small> pts</small></b></div>) : <p className="empty-state">No scores for this period yet.</p>}</div></div>
      <div className="league-card"><div className="card-top"><div><span className="label">TOP COLLEGES</span><h2>Campus cup</h2></div><span className="trophy">✦</span></div><div className="league-table">{data.colleges.length ? data.colleges.map((item, index) => <div className="league-row" key={item.name}><strong>{index + 1}</strong><span className="college-icon">◎</span><span className="league-name">{item.name}<small>{item.players} players · {item.accuracy}% accuracy</small></span><b>{item.points}<small> pts</small></b></div>) : <p className="empty-state">No college scores yet.</p>}</div></div>
    </div>
  </section>;
}
