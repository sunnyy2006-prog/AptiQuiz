import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";

const medals = ["#c8f66b", "#c4cdea", "#d99a6c"];

function PodiumBlocks({ players }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <pointLight color="#32d6ff" intensity={18} distance={12} position={[3, 4, 4]} />
      <pointLight color="#9b7cff" intensity={12} distance={10} position={[-4, 2, 1]} />
      {players.slice(0, 3).map((player, index) => {
        const height = [2.1, 1.45, 1.05][index];
        const x = [-1.65, 0, 1.65][index];
        return (
          <Float key={player.name} speed={1.2} floatIntensity={0.12} rotationIntensity={0.04}>
            <group position={[x, height / 2 - 1.35, 0]}>
              <mesh>
                <boxGeometry args={[1.35, height, 1.35]} />
                <meshStandardMaterial color={index === 0 ? "#3b337c" : "#202b50"} emissive={index === 0 ? "#33276d" : "#141d3b"} emissiveIntensity={0.55} metalness={0.4} roughness={0.3} />
              </mesh>
              <Text color={medals[index]} fontSize={0.32} position={[0, height / 2 + 0.28, 0]} anchorX="center" anchorY="middle">{player.name.slice(0, 12)}</Text>
              <Text color={medals[index]} fontSize={0.26} position={[0, -height / 2 + 0.22, 0.7]} rotation={[-Math.PI / 2, 0, 0]} anchorX="center" anchorY="middle">{`#${index + 1}`}</Text>
            </group>
          </Float>
        );
      })}
      <Sparkles count={28} scale={[8, 4, 4]} size={1.5} speed={0.25} color="#c8f66b" />
    </>
  );
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export default function Podium({ players }) {
  const [fallback] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches || !supportsWebGL());
  const [hidden, setHidden] = useState(() => document.hidden);
  const topPlayers = useMemo(() => players.slice(0, 3), [players]);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  if (fallback) {
    return <div className="podium-2d" aria-label={`Podium: ${topPlayers.map((player, index) => `${index + 1}. ${player.name}`).join(", ")}`}>{topPlayers.map((player, index) => <div className={`podium-place place-${index + 1}`} key={player.name}><span>{index + 1}</span><strong>{player.name}</strong><small>{player.score} pts</small></div>)}</div>;
  }

  return <div className="podium-3d" aria-hidden="true"><Canvas dpr={[1, 1.5]} frameloop={hidden ? "never" : "always"} camera={{ position: [0, 1.8, 8], fov: 38 }} gl={{ antialias: false, powerPreference: "high-performance" }}><Suspense fallback={null}><PodiumBlocks players={topPlayers} /></Suspense></Canvas></div>;
}
