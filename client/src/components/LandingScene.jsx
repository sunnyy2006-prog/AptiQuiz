import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Grid, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";

function QuestionCube({ tilt }) {
  const group = useRef(null);
  const target = useRef(new THREE.Vector2());

  useEffect(() => {
    target.current.set(tilt.x, tilt.y);
  }, [tilt]);

  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.18;
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, target.current.y * 0.16, 4, delta);
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, target.current.x * -0.14, 4, delta);
  });

  return (
    <Float speed={1.1} rotationIntensity={0.12} floatIntensity={0.35}>
      <group ref={group}>
        <mesh castShadow>
          <boxGeometry args={[2.35, 2.35, 2.35]} />
          <meshStandardMaterial color="#171d43" emissive="#211a58" emissiveIntensity={0.55} metalness={0.45} roughness={0.28} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(2.35, 2.35, 2.35)]} />
          <lineBasicMaterial color="#6f7cff" transparent opacity={0.7} />
        </lineSegments>
        <Text color="#c8f66b" fontSize={1.25} anchorX="center" anchorY="middle" position={[0, 0, 1.19]} outlineColor="#6b4bcb" outlineWidth={0.025}>
          ?
        </Text>
      </group>
    </Float>
  );
}

function ArenaScene({ tilt }) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <pointLight color="#32d6ff" intensity={16} distance={10} position={[3, 3, 4]} />
      <pointLight color="#9b7cff" intensity={12} distance={8} position={[-4, 1, -1]} />
      <QuestionCube tilt={tilt} />
      <Sparkles count={36} scale={[9, 5, 8]} size={1.5} speed={0.18} color="#a8dfff" />
      <Grid args={[18, 18]} cellColor="#273f70" cellSize={0.65} fadeDistance={12} fadeStrength={2.2} infiniteGrid position={[0, -1.7, 0]} sectionColor="#5366aa" sectionSize={3} />
    </>
  );
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

function shouldUseFallback() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const connection = navigator.connection;
  const lowPower = navigator.deviceMemory <= 2 || navigator.hardwareConcurrency <= 2 || connection?.saveData || /slow-2g|2g/.test(connection?.effectiveType || "");
  return reducedMotion || lowPower || !supportsWebGL();
}

export default function LandingScene() {
  const [fallback, setFallback] = useState(() => shouldUseFallback());
  const [hidden, setHidden] = useState(() => document.hidden);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [orientationEnabled, setOrientationEnabled] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    const onPointerMove = (event) => {
      setTilt({
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  useEffect(() => {
    if (!("DeviceOrientationEvent" in window)) return undefined;
    if (typeof DeviceOrientationEvent.requestPermission !== "function") {
      setOrientationEnabled(true);
      return undefined;
    }
    const requestOrientation = () => {
      DeviceOrientationEvent.requestPermission().then((permission) => {
        if (permission === "granted") setOrientationEnabled(true);
      }).catch(() => setOrientationEnabled(false));
    };
    window.addEventListener("touchstart", requestOrientation, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", requestOrientation);
  }, []);

  useEffect(() => {
    if (!orientationEnabled) return undefined;
    const onOrientation = (event) => setTilt({ x: (event.gamma || 0) / 30, y: (event.beta || 0) / 30 });
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [orientationEnabled]);

  const camera = useMemo(() => ({ position: [0, 0.4, 7], fov: 35 }), []);
  if (fallback) return <div className="scene-fallback" aria-hidden="true" />;

  return (
    <div className="landing-scene" aria-hidden="true">
      <Canvas camera={camera} dpr={[1, 1.5]} frameloop={hidden ? "never" : "always"} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <Suspense fallback={null}>
          <ArenaScene tilt={tilt} />
        </Suspense>
      </Canvas>
    </div>
  );
}
