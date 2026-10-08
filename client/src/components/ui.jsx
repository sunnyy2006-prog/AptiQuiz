import { motion, useReducedMotion } from "framer-motion";

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
    <div className="timer-bar" role="progressbar" aria-label={`${value} seconds remaining`} aria-valuemax={max} aria-valuemin="0" aria-valuenow={value}>
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
