import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts a figure up when it first appears and whenever it changes, so a
 * refreshed dashboard reads as live rather than as a silent swap. The last
 * frame is always the exact value — never a rounded approximation.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(n),
  duration = 750,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  // the figure actually on screen — read as the origin of the next run, so a
  // cancelled run (StrictMode's double effect, or a value that changes
  // mid-flight) resumes from where it stopped instead of snapping
  const current = useRef(shown);
  const frame = useRef<number>();

  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(value)) {
      current.current = value;
      setShown(value);
      return;
    }
    const origin = current.current;
    const delta = value - origin;
    if (delta === 0) return;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out quart
      const next = t === 1 ? value : origin + delta * eased;
      current.current = next;
      setShown(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, duration]);

  return <span className={className}>{format(Math.round(shown))}</span>;
}
