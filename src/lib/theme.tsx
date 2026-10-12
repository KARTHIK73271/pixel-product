import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/** Must match the pre-paint script in index.html, or the first frame flashes. */
function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode / blocked storage — fall through to the system default */
  }
  return 'system';
}

const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

interface ThemeContext {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const Ctx = createContext<ThemeContext>({ preference: 'system', resolved: 'dark', setPreference: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  // follow the OS while the preference is "system"
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  // `data-theme` drives the token block in index.css, which also sets
  // `color-scheme` so form controls and scrollbars follow along.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.background = resolved === 'light' ? '#f7f3ea' : '#031c16';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#F7F3EA' : '#031C16');
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* the choice just won't survive a reload */
    }
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/**
 * Chart colours live in CSS so both themes define them in one place, but
 * Recharts needs real values — it writes them into SVG attributes. Re-read
 * whenever the resolved theme changes.
 */
export function useChartTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const { resolved } = useTheme();
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()])) as Record<K, string>;
    // `resolved` is the real input here: it is what changes the computed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, names]);
}
