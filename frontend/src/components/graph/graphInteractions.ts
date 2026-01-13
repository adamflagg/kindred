/**
 * Graph interaction utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape';

/**
 * Adjust label positions to prevent overlap
 */
export function adjustLabelPositions(cy: Core): void {
  // Check if cy is valid and not destroyed
  if (!cy || cy.destroyed()) return;

  // Sort nodes by Y position (exclude parent nodes - they have fixed label positions)
  const nodes = cy
    .nodes()
    .filter((n) => !n.data('isBunkParent'))
    .sort((a, b) => {
      return (a as NodeSingular).position().y - (b as NodeSingular).position().y;
    });

  // Track label positions to detect overlaps
  const labelBounds: Array<{
    node: NodeSingular;
    top: number;
    bottom: number;
    left: number;
    right: number;
  }> = [];

  nodes.forEach((node) => {
    // Add null check for node and ensure it's not removed
    if (!node || node.removed()) return;

    try {
      const pos = node.renderedPosition();
      const bb = node.renderedBoundingBox();
      const label = node.data('label') || '';
      const labelWidth = label.length * 6; // Approximate width
      const labelHeight = 14; // Font size

      // Default label position (below node)
      let offsetY = 5;
      let collision = true;
      let attempts = 0;

      // Try different positions to avoid overlap
      while (collision && attempts < 10) {
        const labelTop = bb.y2 + offsetY;
        const labelBottom = labelTop + labelHeight;
        const labelLeft = pos.x - labelWidth / 2;
        const labelRight = pos.x + labelWidth / 2;

        collision = false;

        // Check collision with other labels
        for (const other of labelBounds) {
          if (other.node.id() === node.id()) continue;

          // Check if rectangles overlap
          if (
            !(
              labelRight < other.left ||
              labelLeft > other.right ||
              labelBottom < other.top ||
              labelTop > other.bottom
            )
          ) {
            collision = true;
            offsetY += 15; // Move down
            break;
          }
        }

        attempts++;

        if (!collision) {
          // Save this label's bounds
          labelBounds.push({
            node,
            top: labelTop,
            bottom: labelBottom,
            left: labelLeft,
            right: labelRight,
          });

          // Apply the offset
          node.style('text-margin-y', offsetY);
        }
      }
    } catch {
      // Silently skip this node if there's an error accessing its properties
      // This can happen during view transitions
    }
  });
}

/**
 * Show ego network for a specific node (highlight the node and its neighbors)
 */
export function showEgoNetwork(cy: Core, nodeId: string): void {
  if (!cy || cy.destroyed()) return;

  const node = cy.$(`#${nodeId}`);
  const neighborhood = node.closedNeighborhood();

  cy.elements().addClass('faded');
  neighborhood.removeClass('faded');
}

/**
 * Update edge visibility based on filter settings
 */
export function updateEdgeVisibility(
  cy: Core,
  showEdges: Record<string, boolean>
): void {
  if (!cy || cy.destroyed()) return;

  // Batch style updates for better performance
  cy.batch(() => {
    cy.edges().forEach((edge) => {
      const edgeType = edge.data('edge_type');
      const isBundled = edgeType === 'bundled';

      if (isBundled) {
        // For bundled edges, check if any of the bundled types should be shown
        const types = edge.data('types') || [];
        const shouldShow = types.some((type: string) => showEdges[type]);

        edge.style({
          opacity: shouldShow ? 1 : 0,
          events: shouldShow ? 'yes' : 'no',
          'transition-property': 'opacity',
          'transition-duration': '300ms',
          'transition-timing-function': 'ease-in-out',
        });
      } else if (edgeType in showEdges) {
        // Known edge type - use checkbox state with smooth transition
        const shouldShow = showEdges[edgeType];

        edge.style({
          opacity: shouldShow ? 1 : 0,
          events: shouldShow ? 'yes' : 'no',
          'transition-property': 'opacity',
          'transition-duration': '300ms',
          'transition-timing-function': 'ease-in-out',
        });
      } else {
        // Unknown edge type - hide with transition
        edge.style({
          opacity: 0,
          events: 'no',
          'transition-property': 'opacity',
          'transition-duration': '300ms',
          'transition-timing-function': 'ease-in-out',
        });
      }
    });
  });
}

/**
 * Setup dynamic label visibility based on zoom level
 */
export function setupZoomBasedLabels(cy: Core): void {
  if (!cy || cy.destroyed()) return;

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
}

/**
 * Setup node hover interactions (for mouse devices)
 */
export function setupNodeHover(cy: Core): void {
  if (!cy || cy.destroyed()) return;

  // Show label on hover
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

/**
 * Setup tap-to-reveal for touch devices
 * On touch, tapping a node reveals its label temporarily
 */
export function setupTapToReveal(cy: Core): void {
  if (!cy || cy.destroyed()) return;

  let lastTappedNode: NodeSingular | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  cy.on('tap', 'node', (event) => {
    const node = event.target;

    // If tapping the same node, do nothing special
    if (lastTappedNode && lastTappedNode.id() === node.id()) {
      return;
    }

    // Clear previous timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    // Hide label from previously tapped node
    if (lastTappedNode && !lastTappedNode.removed()) {
      lastTappedNode.removeClass('highlighted');
      cy.emit('zoom'); // Re-evaluate if it should be hidden
    }

    // Show label for tapped node
    node.addClass('highlighted');
    node.removeClass('hide-label');
    lastTappedNode = node;

    // Auto-hide after 5 seconds (gives time to read)
    hideTimeout = setTimeout(() => {
      if (node && !node.removed()) {
        node.removeClass('highlighted');
        cy.emit('zoom');
      }
      lastTappedNode = null;
    }, 5000);
  });

  // Tap on background clears highlighted node
  cy.on('tap', (event) => {
    if (event.target === cy) {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
      if (lastTappedNode && !lastTappedNode.removed()) {
        lastTappedNode.removeClass('highlighted');
        cy.emit('zoom');
      }
      lastTappedNode = null;
    }
  });
}
