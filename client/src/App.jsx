import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io();

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleJoined = ({ roomId: joinedRoomId }) => setJoinedRoom(joinedRoomId);
    const handlePlayers = (roomPlayers) => setPlayers(roomPlayers);
    const handleError = ({ message }) => setError(message);

    socket.on("room:joined", handleJoined);
    socket.on("room:players", handlePlayers);
    socket.on("room:error", handleError);
    return () => {
      socket.off("room:joined", handleJoined);
      socket.off("room:players", handlePlayers);
      socket.off("room:error", handleError);
    };
  }, []);

  function joinRoom(event) {
    event.preventDefault();
    setError("");
    socket.emit("room:join", { roomId, playerName });
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
