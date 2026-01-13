/**
 * Graph layout utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape';
import type { LayoutWorkerInput } from '../../workers/layoutWorker';
import type { ParentNodeElement, CamperNodeElement, EdgeElement } from './cytoscapeStyles';
import { showEgoNetwork } from './graphInteractions';

/**
 * FCOSE layout options for force-directed graph layout
 */
export const FCOSE_LAYOUT_OPTIONS = {
  name: 'fcose',
  numIter: 1000,
  packComponents: true,
  componentSpacing: 120,
  nodeSeparation: 100,
  uniformNodeDimensions: false,
  nodeOverlap: 60,
  fit: true,
  padding: 80,
  gravityCompound: 1.5,
  gravityRangeCompound: 2.0,
  nestingFactor: 0.15,
  tilingPaddingVertical: 15,
  tilingPaddingHorizontal: 15,
} as const;

/**
 * Prepare graph elements for the layout worker
 */
export function prepareWorkerInput(
  parentNodes: ParentNodeElement[],
  nodes: CamperNodeElement[],
  edges: EdgeElement[]
): LayoutWorkerInput {
  const allNodes = [...parentNodes, ...nodes];
  const workerNodes = allNodes.map((n) => {
    const data: Record<string, unknown> = {
      id: n.data.id,
      label: n.data.label,
    };
    if ('parent' in n.data && n.data['parent']) {
      data['parent'] = n.data['parent'];
    }
    if ('isBunkParent' in n.data) {
      data['isBunkParent'] = n.data['isBunkParent'];
    }
    return { data };
  });

  const workerEdges = edges.map((e) => ({
    data: {
      id: e.data.id,
      source: e.data.source,
      target: e.data.target,
      edge_type: e.data.edge_type,
      priority: e.data.priority,
    } as Record<string, unknown>,
  }));

  return {
    nodes: workerNodes as LayoutWorkerInput['nodes'],
    edges: workerEdges as LayoutWorkerInput['edges'],
    options: {
      numIter: 1000,
      componentSpacing: 120,
      nodeSeparation: 100,
    },
  };
}

export interface SetupEventHandlersOptions {
  onNodeSelect: (nodeId: number) => void;
  onClearSelection: () => void;
  viewMode: 'all' | 'community' | 'ego';
}

/**
 * Setup graph event handlers for node selection and interaction
 * Includes tap-to-reveal for mobile devices
 */
export function setupGraphEventHandlers(
  cy: Core,
  { onNodeSelect, onClearSelection, viewMode }: SetupEventHandlersOptions
): void {
  // Track last tapped node for tap-to-reveal on touch devices
  let lastHighlightedNode: NodeSingular | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Event handlers - skip parent (compound) nodes for selection/ego
  cy.on('tap', 'node', (event) => {
    const node = event.target;
    if (node.data('isBunkParent')) return; // Skip parent nodes
    onNodeSelect(node.data('id'));

    if (viewMode === 'ego') {
      showEgoNetwork(cy, node.id());
    }

    // Tap-to-reveal for touch devices: highlight node and show label
    // Clear previous timeout if any
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    // Clear previous highlight
    if (lastHighlightedNode && !lastHighlightedNode.removed() && lastHighlightedNode.id() !== node.id()) {
      lastHighlightedNode.removeClass('highlighted');
      cy.emit('zoom'); // Re-evaluate label visibility
    }

    // Highlight tapped node and show label
    node.addClass('highlighted');
    node.removeClass('hide-label');
    lastHighlightedNode = node;

    // Auto-hide highlight after 5 seconds (for touch devices)
    hideTimeout = setTimeout(() => {
      if (node && !node.removed()) {
        node.removeClass('highlighted');
        cy.emit('zoom');
      }
      lastHighlightedNode = null;
    }, 5000);
  });

  cy.on('tap', (event) => {
    if (event.target === cy) {
      onClearSelection();
      if (viewMode === 'ego') {
        cy.elements().removeClass('faded');
      }

      // Clear highlighted node on background tap
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
      if (lastHighlightedNode && !lastHighlightedNode.removed()) {
        lastHighlightedNode.removeClass('highlighted');
        cy.emit('zoom');
      }
      lastHighlightedNode = null;
    }
  });

  // Dynamic label visibility based on zoom (skip parent nodes - they have fixed labels)
  cy.on('zoom', () => {
    const zoom = cy.zoom();
    const threshold = zoom < 0.5 ? 0.8 : zoom < 0.7 ? 0.6 : 0.4;

    cy.nodes()
      .filter((n) => !n.data('isBunkParent'))
      .forEach((node) => {
        const neighbors = node.neighborhood().nodes();
        const density = neighbors.length / 15; // Normalize density

        if (density > threshold && !node.hasClass('highlighted')) {
          node.addClass('hide-label');
        } else {
          node.removeClass('hide-label');
        }
      });
  });

  // Show label on hover (for mouse/pointer devices)
  cy.on('mouseover', 'node', (event) => {
    const node = event.target;
    node.addClass('highlighted');
    node.removeClass('hide-label');
  });

  cy.on('mouseout', 'node', (event) => {
    const node = event.target;
    node.removeClass('highlighted');
    // Re-check if it should be hidden based on zoom
    cy.emit('zoom');
  });
}
