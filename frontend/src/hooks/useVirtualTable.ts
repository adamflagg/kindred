import type { MutableRefObject } from 'react';
import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface UseVirtualTableOptions<T> {
  data: T[];
  height?: number;
  estimateRowSize?: (index: number, item: T) => number;
  overscan?: number;
  enableDynamicHeights?: boolean;
  expandedRows?: Set<string>;
  rowHeightPreset?: 'compact' | 'normal' | 'comfortable' | 'dynamic';
}

export interface UseVirtualTableReturn {
  parentRef: MutableRefObject<HTMLDivElement | null>;
  rowVirtualizer: ReturnType<typeof useVirtualizer>; // Properly typed virtualizer
  isPageScrolling: boolean;
}

// Row height presets
const rowHeightPresets = {
  compact: 48,
  normal: 59, // 58px + 1px pseudo-border
  comfortable: 72,
  dynamic: -1 // Use estimateRowSize
};

export function useVirtualTable<T extends { id: string }>({
  data,
  height: _height = 600,
  estimateRowSize,
  overscan = 10,
  enableDynamicHeights = false,
  expandedRows = new Set<string>(),
  rowHeightPreset = 'normal',
}: UseVirtualTableOptions<T>): UseVirtualTableReturn {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const isPageScrolling = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default row size estimator
  const defaultEstimateSize = useCallback((index: number) => {
    if (rowHeightPreset === 'dynamic' && estimateRowSize) {
      const item = data[index];
      if (item === undefined) {
        return rowHeightPresets.normal;
      }
      return estimateRowSize(index, item);
    }
    if (!enableDynamicHeights || !estimateRowSize) {
      return rowHeightPresets[rowHeightPreset] || rowHeightPresets.normal;
    }
    const item = data[index];
    if (item === undefined) {
      return rowHeightPresets.normal;
    }
    return estimateRowSize(index, item);
  }, [data, enableDynamicHeights, estimateRowSize, rowHeightPreset]);

  // Virtual scrolling setup
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: defaultEstimateSize,
    overscan,
    ...(enableDynamicHeights && { measureElement: (element) => element.getBoundingClientRect().height }),
  });

  // Detect page scroll to prevent bounce conflicts
  useEffect(() => {
    const handleScroll = () => {
      isPageScrolling.current = true;
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Reset scroll state after delay
      scrollTimeoutRef.current = setTimeout(() => {
        isPageScrolling.current = false;
      }, 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Force remeasure when expanded rows change
  useEffect(() => {
    if (enableDynamicHeights && expandedRows && expandedRows.size >= 0) {
      // Use requestAnimationFrame to avoid synchronous updates
      requestAnimationFrame(() => {
        rowVirtualizer.measure();
      });
    }
  }, [expandedRows, enableDynamicHeights, rowVirtualizer]);

  return {
    parentRef,
    // Cast needed because Virtualizer<HTMLDivElement, Element> is not assignable to Virtualizer<Element, Element>
    rowVirtualizer: rowVirtualizer as unknown as ReturnType<typeof useVirtualizer>,
    isPageScrolling: isPageScrolling.current,
  };
}

// Standard table styles
export const tableStyles = {
  container: 'bg-card rounded-lg border overflow-hidden shadow-sm',
  header: 'bg-primary/5 sticky top-0 z-10 backdrop-blur-sm border-b border-border',
  headerCell: 'px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider',
  row: 'border-b hover:bg-muted/20',
  cell: 'px-4 py-3 text-sm',
  // Alignment helpers
  alignLeft: 'text-left',
  alignCenter: 'text-center flex items-center justify-center',
  alignRight: 'text-right flex items-center justify-end',
  // Virtual scroll container
  scrollContainer: (height: number, isPageScrolling: boolean) => ({
    height: `${height}px`,
    overscrollBehaviorY: 'contain' as const,
    overscrollBehaviorX: 'none' as const,
    WebkitOverflowScrolling: 'touch' as const,
    touchAction: 'pan-y' as const,
    pointerEvents: isPageScrolling ? 'none' as const : 'auto' as const,
  }),
};

// Column width recommendations
export const columnWidths = {
  // Checkbox/small icon columns
  checkbox: '40px',
  icon: '50px',
  
  // Text columns
  name: 'minmax(180px,2fr)',      // Primary text, flexible
  description: 'minmax(200px,3fr)', // Long text, more flexible
  
  // Numeric columns  
  age: 'minmax(60px,80px)',        // 2-3 digits
  grade: 'minmax(60px,80px)',      // 1-2 digits
  count: 'minmax(80px,100px)',     // 1-4 digits
  
  // Status/Badge columns
  status: 'minmax(100px,120px)',   // Short badges
  badge: 'minmax(90px,110px)',     // Single badge
  type: 'minmax(120px,140px)',     // Medium badges
  gender: 'minmax(60px,80px)',     // M/F/NB badges
  genderIdentity: 'minmax(140px,160px)', // Longer gender identity
  
  // Other columns
  session: 'minmax(100px,140px)',  // Session names
  bunk: 'minmax(80px,100px)',      // Bunk codes
  actions: 'minmax(100px,120px)',  // 2-3 action buttons
  
  // Priority based columns
  priority: 'minmax(80px,100px)',  // Priority numbers
  confidence: 'minmax(90px,110px)', // Percentage values
};