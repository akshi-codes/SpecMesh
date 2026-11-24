import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "./ui.jsx";

export function Menu({ label, children, icon, className = "" }) {
  const [open, setOpen] = useState(false),
    ref = useRef(null),
    button = useRef(null),
    id = useId(),
    reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
      if (
        ["ArrowDown", "ArrowUp"].includes(e.key) &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) &&
        ref.current?.contains(document.activeElement)
      ) {
        e.preventDefault();
        const items = [
          ...ref.current.querySelectorAll(
            "[data-menu] button,[data-menu] a,[data-menu] input",
          ),
        ].filter((x) => !x.disabled);
        const i = items.indexOf(document.activeElement);
        items[
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    ref.current
      ?.querySelector("[data-menu] button,[data-menu] a,[data-menu] input")
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        className="export-link-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
        <ChevronDown
          size={14}
          className={
            open ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            data-menu
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduce ? 0 : -4 }}
            transition={{ duration: reduce ? 0 : 0.16 }}
            className="menu-surface"
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export function Sheet({ title, onClose, children, side = "right" }) {
  const panel = useRef(null),
    closeRef = useRef(onClose),
    reduce = useReducedMotion(),
    id = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      root = document.getElementById("root"),
      oldOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const items = [
          ...panel.current.querySelectorAll(
            'button,a[href],input,select,textarea,[tabindex="0"]',
          ),
        ].filter((el) => !el.disabled && el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (root) root.inert = false;
      document.body.style.overflow = oldOverflow;
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <motion.div
      className="fixed inset-0 z-40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.18 }}
    >
      <button
        className="absolute inset-0 bg-foreground/30"
        aria-label="Close detail panel"
        onClick={onClose}
      />
      <motion.section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        initial={reduce ? false : { x: side === "left" ? -48 : 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: reduce ? 0 : side === "left" ? -32 : 32, opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={`absolute inset-y-0 overflow-y-auto border-border bg-background shadow-lift outline-none ${side === "left" ? "left-0 w-[min(20rem,88vw)] border-r" : "right-0 w-full max-w-3xl border-l"}`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-4">
          <h2 id={id} className="text-xl font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close detail panel"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </header>
        <div className="space-y-6 p-5 sm:p-7">{children}</div>
      </motion.section>
    </motion.div>,
    document.body,
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
