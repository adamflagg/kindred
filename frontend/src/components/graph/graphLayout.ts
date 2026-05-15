/**
 * Graph layout utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape'
import type { LayoutWorkerInput } from '../../workers/layoutWorker'
import { labelDensityThreshold } from './constants'
import type { ParentNodeElement, CamperNodeElement, EdgeElement } from './cytoscapeStyles'

export interface FcoseOptionsParams {
  hasCompoundNodes: boolean
}

/**
 * Single source of truth for fcose layout configuration. Both the worker
 * and the main-thread fallback path use this so layouts are identical.
 *
 * Returned object is fully serializable (no functions) so it can cross the
 * postMessage boundary into the layout worker. Non-serializable extras like
 * `idealEdgeLength` (a function) are added at the cy.layout() call site.
 */
export function getFcoseOptions(params: FcoseOptionsParams) {
  // Tightened from the previous 200 → less whitespace between bunks and
  // between unit halves so the whole graph fits without constant zooming.
  // Without compound (bunk) parents, fcose packs nodes too tightly — keep
  // expanded spacing for unparented camper-only graphs.
  const compound = {
    nodeSeparation: 130,
    componentSpacing: 130,
  }
  const noCompound = {
    nodeSeparation: 400,
    componentSpacing: 400,
  }
  const spacing = params.hasCompoundNodes ? compound : noCompound

  return {
    name: 'fcose',
    animate: false,
    // 300 iters: empirically converges on this graph size; fcose default is
    // 2500 (way overkill for our N). Quality-neutral perf knob.
    numIter: 300,
    // Keep at default — disabling triggers fcose internals that are less
    // battle-tested and can throw on graphs with mixed unparented/parented
    // compound structures (e.g. AG bunks with no unit parent alongside
    // unit-side compounds).
    packComponents: true,
    nodeSeparation: spacing.nodeSeparation,
    componentSpacing: spacing.componentSpacing,
    uniformNodeDimensions: false,
    nodeOverlap: 120,
    fit: true,
    padding: 80,
    // Higher gravityCompound pulls children toward their compound centroid;
    // bumped from 1.0 so unit clusters stay tight when request edges
    // would otherwise scatter cross-unit bunks.
    gravityCompound: 2.0,
    gravityRangeCompound: 1.5,
    nestingFactor: 0.1,
    tilingPaddingVertical: 30,
    tilingPaddingHorizontal: 30,
    // 'default' runs fcose's spectral pre-layout for good initial spread;
    // 'draft' collapsed the graph to a line on this dataset (paired with
    // strong gravityCompound, the force phase alone could not recover
    // from a random seed).
    quality: 'default' as const,
    randomize: true,
  }
}

/**
 * Prepare graph elements for the layout worker.
 * Ships full fcose options derived from getFcoseOptions so the worker is
 * a passthrough and both paths produce identical layouts.
 */
export function prepareWorkerInput(
  parentNodes: ParentNodeElement[],
  nodes: CamperNodeElement[],
  edges: EdgeElement[]
): LayoutWorkerInput {
  const allNodes = [...parentNodes, ...nodes]
  const workerNodes = allNodes.map((n) => {
    const data: Record<string, unknown> = {
      id: n.data.id,
      label: n.data.label,
    }
    if ('parent' in n.data && n.data['parent']) {
      data['parent'] = n.data['parent']
    }
    if ('isBunkParent' in n.data) {
      data['isBunkParent'] = n.data['isBunkParent']
    }
    return { data }
  })

  const workerEdges = edges.map((e) => ({
    data: {
      id: e.data.id,
      source: e.data.source,
      target: e.data.target,
      edge_type: e.data.edge_type,
    },
  }))

  return {
    nodes: workerNodes as LayoutWorkerInput['nodes'],
    edges: workerEdges,
    options: getFcoseOptions({ hasCompoundNodes: parentNodes.length > 0 }),
  }
}

export interface SetupEventHandlersOptions {
  onNodeSelect: (nodeId: number) => void
  onClearSelection: () => void
}

/**
 * Setup graph event handlers for node selection and interaction
 * Includes tap-to-reveal for mobile devices
 */
export function setupGraphEventHandlers(
  cy: Core,
  { onNodeSelect, onClearSelection }: SetupEventHandlersOptions
): void {
  // Track last tapped node for tap-to-reveal on touch devices
  let lastHighlightedNode: NodeSingular | null = null
  let hideTimeout: ReturnType<typeof setTimeout> | null = null

  // Event handlers - skip parent (compound) nodes for selection
  cy.on('tap', 'node', (event) => {
    const node = event.target
    if (node.data('isBunkParent')) return // Skip parent nodes
    onNodeSelect(node.data('id'))

    // Tap-to-reveal for touch devices: highlight node and show label
    // Clear previous timeout if any
    if (hideTimeout) {
      clearTimeout(hideTimeout)
    }

    // Clear previous highlight
    if (
      lastHighlightedNode &&
      !lastHighlightedNode.removed() &&
      lastHighlightedNode.id() !== node.id()
    ) {
      lastHighlightedNode.removeClass('highlighted')
      cy.emit('zoom') // Re-evaluate label visibility
    }

    // Highlight tapped node and show label
    node.addClass('highlighted')
    node.removeClass('hide-label')
    lastHighlightedNode = node

    // Auto-hide highlight after 5 seconds (for touch devices)
    hideTimeout = setTimeout(() => {
      if (node && !node.removed()) {
        node.removeClass('highlighted')
        cy.emit('zoom')
      }
      lastHighlightedNode = null
    }, 5000)
  })

  cy.on('tap', (event) => {
    if (event.target === cy) {
      onClearSelection()

      // Clear highlighted node on background tap
      if (hideTimeout) {
        clearTimeout(hideTimeout)
      }
      if (lastHighlightedNode && !lastHighlightedNode.removed()) {
        lastHighlightedNode.removeClass('highlighted')
        cy.emit('zoom')
      }
      lastHighlightedNode = null
    }
  })

  // Dynamic label visibility based on zoom (skip parent nodes - they have fixed labels)
  cy.on('zoom', () => {
    const zoom = cy.zoom()
    const threshold = labelDensityThreshold(zoom)

    cy.nodes()
      .filter((n) => !n.data('isBunkParent'))
      .forEach((node) => {
        const neighbors = node.neighborhood().nodes()
        const density = neighbors.length / 15 // Normalize density

        if (density > threshold && !node.hasClass('highlighted')) {
          node.addClass('hide-label')
        } else {
          node.removeClass('hide-label')
        }
      })
  })

  // Show label on hover (for mouse/pointer devices)
  cy.on('mouseover', 'node', (event) => {
    const node = event.target
    node.addClass('highlighted')
    node.removeClass('hide-label')
  })

  cy.on('mouseout', 'node', (event) => {
    const node = event.target
    node.removeClass('highlighted')
    // Re-check if it should be hidden based on zoom
    cy.emit('zoom')
  })
}
