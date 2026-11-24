import {
  useInView,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "motion/react";
import { useCallback, useEffect, useRef } from "react";

export default function CountUp({
  to,
  from = 0,
  direction = "up",
  delay = 0,
  duration = 1.2,
  className = "",
  startWhen = true,
  separator = ",",
  suffix = "",
}) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(direction === "down" ? to : from);
  const springValue = useSpring(motionValue, {
    damping: 20 + 40 * (1 / duration),
    stiffness: 100 * (1 / duration),
  });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const decimalPlaces = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));
  const formatValue = useCallback(
    (latest) => {
      const formatted = Intl.NumberFormat("en-US", {
        useGrouping: Boolean(separator),
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(latest);
      return `${separator ? formatted.replace(/,/g, separator) : formatted}${suffix}`;
    },
    [decimalPlaces, separator, suffix],
  );

  useEffect(() => {
    if (ref.current)
      ref.current.textContent = formatValue(direction === "down" ? to : from);
  }, [direction, formatValue, from, to]);

  useEffect(() => {
    if (!isInView || !startWhen) return undefined;
    const timeoutId = setTimeout(() => {
      motionValue.set(direction === "down" ? from : to);
    }, delay * 1000);
    return () => clearTimeout(timeoutId);
  }, [delay, direction, from, isInView, motionValue, startWhen, to]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = formatValue(latest);
      }),
    [formatValue, springValue],
  );

  return reduce ? (
    <span className={className}>{formatValue(to)}</span>
  ) : (
    <span className={className} ref={ref} />
  );
}

function getDecimalPlaces(value) {
  const [, decimals = ""] = String(value).split(".");
  return Number.parseInt(decimals || "0", 10) === 0 ? 0 : decimals.length;
}
