import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark';
interface ThemeState { mode: ThemeMode; palette: string; view?: string; toggleMode(): void; setMode(mode: ThemeMode): void; }
const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => localStorage.getItem('marquee-mode') === 'light' ? 'light' : 'dark');
  const value = useMemo(() => ({
    mode, palette: 'marquee', setMode: (next: ThemeMode) => { localStorage.setItem('marquee-mode', next); setMode(next); },
    toggleMode: () => setMode(current => { const next = current === 'dark' ? 'light' : 'dark'; localStorage.setItem('marquee-mode', next); return next; }),
  }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeModeProvider is required');
  return value;
}
