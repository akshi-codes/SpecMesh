import { Inbox } from "lucide-react";
import { motion } from "motion/react";
import CountUp from "./CountUp.jsx";
import { clsx } from "../lib/clsx.js";

export function Card({ children, className = "" }) {
  return (
    <section className={clsx("relative overflow-hidden rounded-2xl border border-border/80 bg-card/95 text-cardForeground shadow-panel", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action, eyebrow, description }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-5 sm:px-6">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[0.68rem] font-semibold tracking-[0.16em] text-accent">{eyebrow}</p> : null}
        <h2 className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-sm font-normal leading-6 text-mutedForeground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Button({ children, className = "", variant = "primary", size = "default", ...props }) {
  const variants = {
    primary: "border border-primary bg-primary text-primaryForeground shadow-[0_8px_20px_rgb(31_55_45/0.14)] hover:bg-primary/90",
    secondary: "border border-border bg-card text-foreground hover:border-accent/50 hover:bg-muted/70",
    ghost: "border border-transparent text-mutedForeground hover:bg-muted hover:text-foreground",
    outline: "border border-border bg-transparent text-foreground hover:border-accent/60 hover:bg-muted/60",
  };
  const sizes = {
    default: "h-10 px-3.5",
    icon: "h-10 w-10 px-0",
    sm: "h-8 px-2.5 text-xs",
  };

  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold outline-none transition-[background-color,border-color,color,transform,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, numericValue, suffix = "", sub, tone = "default" }) {
  const tones = {
    default: "bg-card",
    green: "bg-accentSoft/40",
    amber: "bg-warning/[0.08]",
    berry: "bg-danger/[0.08]",
  };
  const dots = {
    default: "bg-foreground/30",
    green: "bg-accent",
    amber: "bg-warning",
    berry: "bg-danger",
  };
  const canAnimate = Number.isFinite(Number(numericValue)) && Math.abs(Number(numericValue)) < 1_000_000;
  const animatedValue = canAnimate
    ? <CountUp to={Number(numericValue)} duration={0.9} separator="," suffix={suffix} className="tabular-nums" />
    : value;

  return (
    <div className={clsx("rounded-2xl border border-border/75 p-4 shadow-[0_8px_22px_rgb(36_52_45/0.04)]", tones[tone])}>
      <div className="flex items-center gap-2">
        <span className={clsx("h-1.5 w-1.5 rounded-full", dots[tone])} />
        <p className="text-xs font-medium text-mutedForeground">{label}</p>
      </div>
      <p className="mt-3 truncate text-2xl font-semibold leading-none tracking-[-0.035em] text-foreground sm:text-3xl" title={String(value ?? numericValue ?? "")}>{animatedValue}</p>
      {sub ? <p className="mt-2 text-xs leading-5 text-mutedForeground">{sub}</p> : null}
    </div>
  );
}

export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "border-border bg-muted text-mutedForeground",
    green: "border-accent/25 bg-accentSoft text-foreground",
    amber: "border-warning/25 bg-warning/10 text-foreground",
    berry: "border-danger/25 bg-danger/10 text-foreground",
  };
  return <span className={clsx("inline-flex rounded-md border px-2 py-1 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="relative inline-flex rounded-lg border border-border bg-muted/70 p-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={clsx("relative z-10 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50", value === item.id ? "text-foreground" : "text-mutedForeground hover:text-foreground")}
          onClick={() => onChange(item.id)}
        >
          {value === item.id ? (
            <motion.div layoutId="tab-pill" className="absolute inset-0 -z-10 rounded-md bg-card shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 30 }} />
          ) : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="relative flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card/80 px-8 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accentSoft text-accent">
        <Inbox size={25} strokeWidth={1.8} />
      </div>
      <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{title}</h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-mutedForeground">{children}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
