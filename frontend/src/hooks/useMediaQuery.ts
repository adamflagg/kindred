import { useCallback, useSyncExternalStore } from 'react';

/**
 * Custom hook for responsive design - detects if a media query matches
 *
 * @param query - CSS media query string (e.g., '(max-width: 768px)')
 * @returns boolean indicating if the media query matches
 *
 * @example
 * const isMobile = useMediaQuery('(max-width: 640px)');
 * const isTablet = useMediaQuery('(min-width: 641px) and (max-width: 1024px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 */
export function useMediaQuery(query: string): boolean {
  // Use useSyncExternalStore pattern for subscribing to media query changes
  // This is the recommended React 18+ pattern for subscribing to external stores
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined') return () => {};
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', callback);
      return () => mediaQuery.removeEventListener('change', callback);
    },
    [query]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Predefined breakpoint hooks for common Tailwind breakpoints
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 640px) and (max-width: 1023px)');
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useIsLargeDesktop(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}

/**
 * Returns responsive state object with all breakpoint info
 */
export function useResponsive() {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isDesktop = useIsDesktop();
  const isLargeDesktop = useIsLargeDesktop();

  return {
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    // Convenience: any touch-likely device (mobile or tablet)
    isTouchDevice: isMobile || isTablet,
  };
}

/**
 * Detects if user prefers dark color scheme
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}

/**
 * Detects if user prefers reduced motion
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Detects device orientation
 */
export function useOrientation(): 'portrait' | 'landscape' {
  const isPortrait = useMediaQuery('(orientation: portrait)');
  return isPortrait ? 'portrait' : 'landscape';
}

/**
 * Detects if the device supports touch
 * Note: This uses pointer media query, not just screen size
 */
export function useHasTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
