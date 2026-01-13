/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextType {
  /** Current theme setting (light, dark, or system) */
  theme: Theme;
  /** The actual resolved theme being displayed (always light or dark) */
  resolvedTheme: ResolvedTheme;
  /** Toggle between light and dark (skips system) */
  toggleTheme: () => void;
  /** Set a specific theme */
  setTheme: (theme: Theme) => void;
  /** Whether system preference is being used */
  isSystemTheme: boolean;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Get the system's preferred color scheme
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Get initial theme from localStorage or default to system preference
 */
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';

  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  // Default to system preference
  return 'system';
}

/**
 * Resolve the actual theme to display based on preference
 */
function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getInitialTheme())
  );

  // Apply theme to document
  const applyTheme = useCallback((resolved: ResolvedTheme) => {
    const root = window.document.documentElement;

    // Add transitioning class to disable transitions temporarily
    root.classList.add('transitioning');

    // Use requestAnimationFrame to ensure the class is applied before theme change
    requestAnimationFrame(() => {
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);

      // Remove transitioning class after a short delay to re-enable transitions
      requestAnimationFrame(() => {
        root.classList.remove('transitioning');
      });
    });
  }, []);

  // Handle theme changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    localStorage.setItem('theme', theme);
  }, [theme, applyTheme]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      const newResolved = e.matches ? 'dark' : 'light';
      setResolvedTheme(newResolved);
      applyTheme(newResolved);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      // When toggling, resolve current and flip
      const current = resolveTheme(prev);
      return current === 'light' ? 'dark' : 'light';
    });
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        toggleTheme,
        setTheme,
        isSystemTheme: theme === 'system',
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
