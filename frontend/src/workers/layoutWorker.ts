/**
 * WebWorker for computing graph layouts off the main thread.
 * Uses Cytoscape in headless mode with fcose for compound node support.
 */

import cytoscape from 'cytoscape';
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose';

// Register fcose extension
cytoscape.use(fcose);

export interface LayoutWorkerInput {
  nodes: Array<{
    data: {
      id: string;
      parent?: string;
      [key: string]: unknown;
    };
  }>;
  edges: Array<{
    data: {
      id: string;
      source: string;
      target: string;
      [key: string]: unknown;
    };
  }>;
  options?: {
    numIter?: number;
    nodeSeparation?: number;
    componentSpacing?: number;
  };
}

export interface LayoutWorkerOutput {
  type: 'positions' | 'error' | 'progress';
  positions?: Record<string, { x: number; y: number }>;
  error?: string;
  progress?: number;
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<LayoutWorkerInput>) => {
  const startTime = performance.now();

  try {
    const { nodes, edges, options = {} } = event.data;

    // Create headless Cytoscape instance
    const cy = cytoscape({
      headless: true,
      styleEnabled: false,
      elements: {
        nodes,
        edges
      }
    });

    // Run fcose layout with compound node support
    const layout = cy.layout({
      name: 'fcose',
      animate: false,
      // Performance tuning - can be adjusted via options
      numIter: options.numIter ?? 1000,
      packComponents: true,
      componentSpacing: options.componentSpacing ?? 120,
      nodeSeparation: options.nodeSeparation ?? 100,
      uniformNodeDimensions: false,
      nodeOverlap: 60,
      fit: true,
      padding: 80,
      // Compound node options - keeps bunk members grouped
      gravityCompound: 1.5,
      gravityRangeCompound: 2.0,
      nestingFactor: 0.15,
      tilingPaddingVertical: 15,
      tilingPaddingHorizontal: 15,
      // Quality settings
      quality: 'default',
      randomize: true,
      // Edge length based on weight for better clustering
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
        const weight = edge.data('weight') || 1;
        return 100 / Math.sqrt(weight);
      }
    } as cytoscape.LayoutOptions);

    // Run layout synchronously (we're in a worker, blocking is fine)
    layout.run();

    // Extract positions
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      const pos = node.position();
      positions[node.id()] = { x: pos.x, y: pos.y };
    });

    const duration = performance.now() - startTime;
    console.log(`[LayoutWorker] Computed ${Object.keys(positions).length} positions in ${duration.toFixed(0)}ms`);

    // Send positions back to main thread
    const response: LayoutWorkerOutput = {
      type: 'positions',
      positions
    };
    self.postMessage(response);

    // Clean up
    cy.destroy();

  } catch (error) {
    const response: LayoutWorkerOutput = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown layout error'
    };
    self.postMessage(response);
  }
};
