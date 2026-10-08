import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io();

export default function App() {
  const [roomId, setRoomId] = useState(() => localStorage.getItem("aptiquiz.roomCode") || "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("aptiquiz.playerName") || "");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const [gameState, setGameState] = useState("lobby");
  const [currentQuestion, setCurrentQuestion] = useState(null);

  useEffect(() => {
    const handlePlayers = (roomPlayers) => setPlayers(roomPlayers);
    const handleError = ({ message }) => {
      setError(message);
      if (/room not found|room is closed|session token is not valid/i.test(message)) {
        localStorage.removeItem("aptiquiz.sessionToken");
        localStorage.removeItem("aptiquiz.roomCode");
      }
    };
    const handleJoined = ({ code, sessionToken, reconnected }) => {
      setJoinedRoom(code);
      localStorage.setItem("aptiquiz.sessionToken", sessionToken);
      localStorage.setItem("aptiquiz.roomCode", code);
      localStorage.setItem("aptiquiz.playerName", playerName);
      if (reconnected) setError("");
    };
    const handleRoomState = ({ state, players: roomPlayers }) => {
      setGameState(state);
      setPlayers(roomPlayers);
    };
    const handleQuestion = (question) => setCurrentQuestion(question);
    const handleConnect = () => {
      const storedCode = localStorage.getItem("aptiquiz.roomCode");
      const sessionToken = localStorage.getItem("aptiquiz.sessionToken");
      const storedName = localStorage.getItem("aptiquiz.playerName");
      if (storedCode && sessionToken) {
        socket.emit("room:join", { code: storedCode, playerName: storedName, sessionToken });
      }
    };

    socket.on("connect", handleConnect);
    socket.on("room:joined", handleJoined);
    socket.on("room:created", handleJoined);
    socket.on("room:players", handlePlayers);
    socket.on("room:error", handleError);
    socket.on("room:state", handleRoomState);
    socket.on("question:start", handleQuestion);
    socket.on("question:reveal", (reveal) => {
      setGameState("reveal");
      setCurrentQuestion(reveal);
    });
    socket.on("game:leaderboard", () => setGameState("leaderboard"));
    return () => {
      socket.off("room:joined", handleJoined);
      socket.off("room:created", handleJoined);
      socket.off("room:players", handlePlayers);
      socket.off("room:error", handleError);
      socket.off("room:state", handleRoomState);
      socket.off("question:start", handleQuestion);
      socket.off("question:reveal");
      socket.off("game:leaderboard");
      socket.off("connect", handleConnect);
    };
  }, []);

  function joinRoom(event) {
    event.preventDefault();
    setError("");
    socket.emit("room:join", {
      code: roomId,
      playerName,
      sessionToken: localStorage.getItem("aptiquiz.roomCode") === roomId.toUpperCase()
        ? localStorage.getItem("aptiquiz.sessionToken") || undefined
        : undefined
    });
    localStorage.setItem("aptiquiz.playerName", playerName);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
          AptiQuiz
        </p>
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-6xl">
          Think fast. Play together.
        </h1>
        <p className="mb-10 max-w-xl text-lg text-slate-400">
          A real-time aptitude quiz for your next group challenge.
        </p>

        {joinedRoom ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <p className="text-sm text-slate-400">You are in room</p>
            <h2 className="mt-1 text-3xl font-bold text-cyan-300">{joinedRoom}</h2>
            <p className="mt-6 font-medium">{players.length} / 50 players</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {players.map((player) => (
                <li className="rounded-lg bg-slate-800 px-3 py-2 text-slate-300" key={player.id}>
                  {player.name}
                </li>
              ))}
            </ul>
            {currentQuestion && (
              <div className="mt-8 border-t border-slate-800 pt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-cyan-400">
                  {gameState} {currentQuestion.remainingMs ? `· ${Math.ceil(currentQuestion.remainingMs / 1000)}s remaining` : ""}
                </p>
                <h3 className="text-xl font-semibold">{currentQuestion.text}</h3>
                <div className="mt-4 grid gap-2">
                  {currentQuestion.options?.map((option, index) => (
                    <button
                      className="rounded-lg border border-slate-700 px-3 py-2 text-left transition hover:border-cyan-400 hover:bg-slate-800"
                      disabled={gameState !== "question"}
                      key={`${option}-${index}`}
                      onClick={() => socket.emit("game:answer", { optionIndex: index })}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          <form className="max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl" onSubmit={joinRoom}>
            <label className="block text-sm font-medium text-slate-300">
              Your name
              <input className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none ring-cyan-400 focus:ring-2" onChange={(event) => setPlayerName(event.target.value)} placeholder="Ada" value={playerName} />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              Room code
              <input className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 uppercase outline-none ring-cyan-400 focus:ring-2" onChange={(event) => setRoomId(event.target.value)} placeholder="QUIZ42" value={roomId} />
            </label>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950 transition hover:bg-cyan-300" type="submit">
              Join room
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
