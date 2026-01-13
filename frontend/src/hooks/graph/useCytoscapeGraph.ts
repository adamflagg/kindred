import type { RefObject, MutableRefObject } from 'react';
import type { Core, Layouts } from 'cytoscape';
import type { ViewMode, PopperRef } from '../../components/graph';

/**
 * Configuration for graph initialization
 */
export interface GraphInitConfig {
  showLabels: boolean;
  showEdges: {
    request: boolean;
    historical: boolean;
    sibling: boolean;
    school: boolean;
  };
  showBubbles: boolean;
  viewMode: ViewMode;
}

/**
 * Refs used by Cytoscape graph
 */
export interface CytoscapeRefs {
  containerRef: RefObject<HTMLDivElement | null>;
  cyRef: MutableRefObject<Core | null>;
  layoutRef: MutableRefObject<Layouts | null>;
  bubblesetsRef: MutableRefObject<unknown | null>;
  pathsRef: MutableRefObject<SVGElement[]>;
  poppersRef: MutableRefObject<PopperRef[]>;
  layoutWorkerRef: MutableRefObject<Worker | null>;
}

/**
 * Batch elements into chunks for staged rendering
 */
export function batchElements<T>(elements: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < elements.length; i += batchSize) {
    batches.push(elements.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Clean up popper instances
 */
export function cleanupPoppers(poppersRef: MutableRefObject<PopperRef[]>): void {
  if (poppersRef.current.length > 0) {
    poppersRef.current.forEach(({ element, instance }) => {
      instance.destroy();
      element.remove();
    });
    poppersRef.current = [];
  }
}

/**
 * Clean up Cytoscape instance
 */
export function cleanupCytoscape(
  cyRef: MutableRefObject<Core | null>,
  layoutRef: MutableRefObject<Layouts | null>,
  bubblesetsRef: MutableRefObject<unknown | null>,
  poppersRef: MutableRefObject<PopperRef[]>
): void {
  if (layoutRef.current && typeof layoutRef.current.stop === 'function') {
    layoutRef.current.stop();
  }
  if (bubblesetsRef.current) {
    (bubblesetsRef.current as { destroy: () => void }).destroy();
    bubblesetsRef.current = null;
  }
  cleanupPoppers(poppersRef);
  if (cyRef.current && !cyRef.current.destroyed()) {
    cyRef.current.destroy();
  }
  cyRef.current = null;
}
