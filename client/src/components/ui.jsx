import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";

export function Button({ children, variant = "primary", className = "", ...props }) {
  return (
    <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function GlassCard({ children, className = "", ...props }) {
  return <div className={`glass-card ${className}`.trim()} {...props}>{children}</div>;
}

export function Badge({ children, tone = "cyan", className = "" }) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`.trim()}>{children}</span>;
}

export function Avatar({ name = "?" }) {
  return <span className="ui-avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

export function TimerBar({ value, max }) {
  const progress = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`timer-bar ${progress <= 33 ? "timer-danger" : progress <= 66 ? "timer-warning" : ""}`} role="progressbar" aria-label={`${value} seconds remaining`} aria-valuemax={max} aria-valuemin="0" aria-valuenow={value}>
      <span style={{ width: `${progress}%` }} />
    </div>
  );
}

export function Toast({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="toast" role="alert">
      <span className="toast-icon" aria-hidden="true">!</span>
      <span>{message}</span>
      {onDismiss && <button className="toast-dismiss" onClick={onDismiss} type="button" aria-label="Dismiss notification">×</button>}
    </div>
  );
}

export function SoundToggle({ enabled, onChange }) {
  return <button className="sound-toggle" onClick={() => onChange(!enabled)} type="button" aria-pressed={enabled} aria-label={enabled ? "Mute sound effects" : "Enable sound effects"}>{enabled ? "🔊 Sound on" : "🔇 Sound off"}</button>;
}

export function useSound(enabled) {
  const audio = useRef(null);
  useEffect(() => () => audio.current?.close(), []);
  return useCallback((type = "tap") => {
    if (!enabled || !window.AudioContext) return;
    const context = audio.current || new window.AudioContext();
    audio.current = context;
    if (context.state === "suspended") context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = ({ tap: 440, correct: 660, error: 180 }[type] || 440);
    oscillator.type = type === "error" ? "sawtooth" : "sine";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.16);
  }, [enabled]);
}

export function ScreenTransition({ children }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
