import { Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'tuello-theme';

/** Inline in <head> before paint so the chosen theme never flashes. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

const ThemeContext = React.createContext<{
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}>({
  theme: 'system',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>('system');
  React.useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      if (t === 'light' || t === 'dark') setThemeState(t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setTheme = React.useCallback((t: ThemePreference) => {
    setThemeState(t);
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, []);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeContext);
}

export function ThemeToggle({
  labels,
}: {
  labels: { theme: string; system: string; light: string; dark: string };
}) {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={labels.theme}>
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor size={16} strokeWidth={1.5} aria-hidden /> {labels.system}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun size={16} strokeWidth={1.5} aria-hidden /> {labels.light}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon size={16} strokeWidth={1.5} aria-hidden /> {labels.dark}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
