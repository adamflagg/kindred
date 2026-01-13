import type { MutableRefObject } from 'react';
import { useState, useEffect, useRef } from 'react';

export interface UseTableLayoutReturn {
  scrollbarWidth: number;
  headerRef: MutableRefObject<HTMLDivElement | null>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
}

export function useTableLayout(): UseTableLayoutReturn {
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measureScrollbar = () => {
      if (scrollRef.current) {
        // Calculate scrollbar width: outer width - inner width
        const width = scrollRef.current.offsetWidth - scrollRef.current.clientWidth;
        setScrollbarWidth(width);
      }
    };

    // Measure initially
    measureScrollbar();

    // Re-measure on window resize
    window.addEventListener('resize', measureScrollbar);
    
    // Also observe the scroll container for size changes
    const resizeObserver = new ResizeObserver(measureScrollbar);
    if (scrollRef.current) {
      resizeObserver.observe(scrollRef.current);
    }

    return () => {
      window.removeEventListener('resize', measureScrollbar);
      resizeObserver.disconnect();
    };
  }, []);

  return {
    scrollbarWidth,
    headerRef,
    scrollRef,
  };
}