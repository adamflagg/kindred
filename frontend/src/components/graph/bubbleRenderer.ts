/**
 * Bunk bubble rendering utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape'
import type { Instance as PopperInstance } from '@popperjs/core'
import { createPopper } from '@popperjs/core'
import { getUnitForBunk } from '../../utils/unitMapping'
import { getUnitColorForBunk, getUnitColorByName } from '../../utils/graphColorUtils'

/** Shared config for bubbleset path rendering (unit and bunk bubbles) */
const BASE_BUBBLE_OPTIONS = {
  maxRoutingIterations: 100,
  threshold: 2,
  pixelGroup: 4,
  includeLabels: false,
  includeMainLabels: false,
  virtualEdges: true,
} as const

/** Shared font styles for unit labels */
const UNIT_LABEL_FONT = {
  fontSize: '14px',
  fontWeight: '700',
  letterSpacing: '0.5px',
} as const

/**
 * Returns the bubbleset path style for a unit boundary bubble.
 * The fill is intentionally 'none' — the boundary is shown by stroke only
 * (#32: fillOpacity: 0 makes any fill color invisible; 'none' is explicit).
 */
export function getUnitBubbleStyle(unitColor: string): {
  fill: string
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  strokeWidth: number
} {
  return {
    fill: 'none',
    fillOpacity: 0,
    stroke: unitColor,
    strokeOpacity: 0.8,
    strokeWidth: 4,
  }
}

export interface BubbleRenderStatus {
  total: number
  rendered: number
  failed: number
}

export interface PopperRef {
  element: HTMLElement
  instance: PopperInstance
}

export interface BubbleRenderRefs {
  bubblesetsRef: { current: unknown | null }
  pathsRef: { current: SVGElement[] }
  poppersRef: { current: PopperRef[] }
  containerRef: { current: HTMLDivElement | null }
}

/**
 * Create a Popper-based label positioned above a group of nodes.
 * Shared by bunk and unit label creation.
 */
function createPopperLabel(
  nodes: NodeSingular[],
  labelEl: HTMLElement,
  containerRef: { current: HTMLDivElement | null },
  poppersRef: { current: PopperRef[] },
  offsetY: number = 10
): void {
  // Find the topmost node in the group to position label above it
  let topmostNode = nodes[0]
  if (!topmostNode) return

  let minY = topmostNode.position().y
  nodes.forEach((node) => {
    if (node.position().y < minY) {
      minY = node.position().y
      topmostNode = node
    }
  })

  document.body.appendChild(labelEl)

  // Create virtual element for Popper that tracks the node position
  const virtualElement = {
    getBoundingClientRect: () => {
      const pos = topmostNode?.renderedPosition() ?? { x: 0, y: 0 }
      const containerRect = containerRef.current?.getBoundingClientRect()

      if (!containerRect) {
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
      }

      const x = containerRect.left + pos.x
      const y = containerRect.top + pos.y

      return {
        top: y,
        bottom: y,
        left: x,
        right: x,
        width: 0,
        height: 0,
        x,
        y,
        toJSON: () => ({ top: y, bottom: y, left: x, right: x, width: 0, height: 0 }),
      } as DOMRect
    },
  }

  const popperInstance = createPopper(virtualElement as unknown as Element, labelEl, {
    placement: 'top',
    modifiers: [
      { name: 'offset', options: { offset: [0, offsetY] } },
      { name: 'preventOverflow', options: { boundary: containerRef.current ?? 'viewport' } },
      {
        name: 'hideOutsideContainer',
        enabled: true,
        phase: 'main',
        fn({ state }) {
          const container = containerRef.current
          if (!container) return
          const containerRect = container.getBoundingClientRect()
          const popperRect = state.elements.popper.getBoundingClientRect()
          const isOutside =
            popperRect.bottom < containerRect.top ||
            popperRect.top > containerRect.bottom ||
            popperRect.right < containerRect.left ||
            popperRect.left > containerRect.right
          state.elements.popper.style.visibility = isOutside ? 'hidden' : 'visible'
        },
      },
    ],
  })

  poppersRef.current.push({ element: labelEl, instance: popperInstance })
}

/**
 * Draw bunk bubbles around groups of campers in the same bunk
 */
export function drawBunkBubbles(
  cy: Core,
  bunksData: Record<number, string> | null | undefined,
  refs: BubbleRenderRefs,
  updateStatus?: (status: BubbleRenderStatus) => void,
  showUnits: boolean = false,
  showBunks: boolean = true
): void {
  const { bubblesetsRef, pathsRef, poppersRef, containerRef } = refs

  // Check if cy is valid before doing anything
  if (cy.destroyed()) {
    console.error('Cytoscape instance is not valid, cannot create bubbles')
    return
  }

  // Clear any existing bubblesets
  if (bubblesetsRef.current) {
    ;(bubblesetsRef.current as { destroy: () => void }).destroy()
    bubblesetsRef.current = null
  }
  pathsRef.current = []

  // Remove any existing bunk labels
  cy.remove('.bunk-label')

  // Group nodes by bunk (excluding label nodes and parent compound nodes)
  const bunkGroups: Record<number, NodeSingular[] | undefined> = {}
  cy.nodes()
    .filter((n) => !n.data('isBunkLabel') && !n.data('isBunkParent'))
    .forEach((node) => {
      const bunkId = node.data('bunk_cm_id')
      if (bunkId) {
        const group = (bunkGroups[bunkId] ??= [])
        group.push(node)
      }
    })

  // Create ONE bubbleset instance
  const bb = (cy as unknown as { bubbleSets: () => unknown }).bubbleSets()
  if (!bb) {
    console.error('Failed to create bubblesets instance')
    return
  }
  bubblesetsRef.current = bb

  // Typed helpers for untyped bubbleset API
  const addPath = (bb as { addPath: (...args: unknown[]) => SVGElement }).addPath.bind(bb)
  const updateBubbles = (bb as { update: (force: boolean) => void }).update.bind(bb)

  // Build the list of all bunk names present in this graph — needed for
  // deterministic color assignment (#31, #33): same bunk set → same colors.
  const allBunkNames: string[] = bunksData ? Object.values(bunksData) : []

  // Collect unit grouping data (needed for both bubble paths and labels)
  const unitGroups: Record<string, NodeSingular[]> = {}

  if (showUnits && bunksData) {
    cy.nodes()
      .filter((n) => !n.data('isBunkLabel') && !n.data('isBunkParent') && !n.data('isUnitParent'))
      .forEach((node) => {
        const bunkId = node.data('bunk_cm_id')
        if (!bunkId) return
        const bunkName = bunksData[bunkId]
        if (!bunkName) return
        const unit = getUnitForBunk(bunkName)
        if (!unit) return
        const group = (unitGroups[unit] ??= [])
        group.push(node)
      })
  }

  // --- Draw order: unit bubbles FIRST (behind), then bunk bubbles ON TOP ---

  // 1. Add unit bubble paths first so they render behind bunk bubbles
  if (showUnits && bunksData) {
    // Build sorted unit list from present groups for deterministic palette (#33)
    const presentUnits = Object.keys(unitGroups)

    Object.entries(unitGroups).forEach(([unitName, nodes]) => {
      if (nodes.length === 0) return

      // #31/#33: deterministic unit color — same unit always gets the same hue
      const unitColor = getUnitColorByName(unitName, presentUnits)

      try {
        const nodeIds = nodes.map((n) => `#${n.id()}`).join(', ')
        const nodeCollection = cy.$(nodeIds)

        const path = addPath(nodeCollection, cy.collection(), cy.collection(), {
          style: getUnitBubbleStyle(unitColor),
          // #32: significantly wider morphBuffer wraps well outside bunk bubbles
          ...BASE_BUBBLE_OPTIONS,
          morphBuffer: 180,
        })
        pathsRef.current.push(path)
      } catch (error) {
        console.error(`Error creating unit bubble for ${unitName}:`, error)
      }
    })
  }

  // 2. Add bunk bubble paths on top of unit bubbles (only when showBunks)
  const renderedBunks: string[] = []
  const failedBunks: string[] = []

  if (!showBunks) {
    // Report zero rendered bunks but DON'T return — unit labels and popper
    // setup still need to run below.
    if (updateStatus) {
      updateStatus({
        total: Object.keys(bunkGroups).length,
        rendered: 0,
        failed: 0,
      })
    }
  }

  if (showBunks) {
    Object.entries(bunkGroups).forEach(([bunkId, nodes]) => {
      if (!nodes || nodes.length === 0) return // Skip empty bunks

      const bunkName = bunksData?.[parseInt(bunkId, 10)] ?? `Bunk ${bunkId}`
      // #31/#33: all bunks in the same unit share the unit's deterministic color
      const bunkColor = getUnitColorForBunk(bunkName, allBunkNames)

      try {
        const nodeIds = nodes.map((n) => `#${n.id()}`).join(', ')
        const nodeCollection = cy.$(nodeIds)

        const path = addPath(
          nodeCollection, // Nodes to include in the bubble
          cy.collection(), // Empty edge collection
          cy.collection(), // No avoid nodes needed - compound layout separates bunks
          {
            style: {
              fill: bunkColor,
              fillOpacity: 0.25,
              stroke: bunkColor,
              strokeOpacity: 0.8,
              strokeWidth: 3,
            },
            ...BASE_BUBBLE_OPTIONS,
            morphBuffer: 35,
          }
        )

        pathsRef.current.push(path)
        renderedBunks.push(`${bunkId} (${bunkName})`)
      } catch (error) {
        console.error(`Error creating bubble for bunk ${bunkId}:`, error)
        failedBunks.push(`${bunkId} (${bunkName}) - Error: ${String(error)}`)
      }
    })
  }

  // Update UI state with rendering status (only when showBunks — the !showBunks
  // branch already reported zero rendered above)
  if (showBunks && updateStatus) {
    updateStatus({
      total: Object.keys(bunkGroups).length,
      rendered: renderedBunks.length,
      failed: failedBunks.length,
    })
  }

  // Force bubbleset to recompute paths
  try {
    updateBubbles(true)
  } catch (updateError) {
    console.error('Error calling bb.update(true):', updateError)
  }

  // Force Cytoscape repaint
  if (!cy.destroyed()) {
    cy.forceRender()
  }

  // Clean up existing popper instances
  if (poppersRef.current.length > 0) {
    poppersRef.current.forEach(({ element, instance }) => {
      instance.destroy()
      element.remove()
    })
    poppersRef.current = []
  }

  // --- Labels: unit labels first (higher offset), then bunk labels ---

  // 3. Add unit labels — solid color matching the unit bubble (#40: no gradient)
  if (showUnits && bunksData) {
    const presentUnits = Object.keys(unitGroups)

    Object.entries(unitGroups).forEach(([unitName, nodes]) => {
      if (nodes.length === 0) return

      // #40: use the same deterministic solid color as the unit bubble, no gradient
      const unitColor = getUnitColorByName(unitName, presentUnits)

      const labelEl = document.createElement('div')
      labelEl.className = 'unit-label-popper'
      labelEl.style.position = 'absolute'
      labelEl.style.zIndex = '1'
      const innerDiv = document.createElement('div')

      // Pill styling with solid unit color border
      Object.assign(labelEl.style, {
        backgroundColor: 'rgba(255,255,255,0.85)',
        padding: '2px 10px',
        borderRadius: '10px',
        whiteSpace: 'nowrap',
        border: `2px solid ${unitColor}`,
      })

      // Font + color — solid, no gradient
      Object.assign(innerDiv.style, UNIT_LABEL_FONT)
      innerDiv.style.color = unitColor

      innerDiv.textContent = unitName
      labelEl.appendChild(innerDiv)

      createPopperLabel(nodes, labelEl, containerRef, poppersRef, 30)
    })
  }

  // 4. Add bunk labels using Popper (only when showBunks)
  if (showBunks) {
    Object.entries(bunkGroups).forEach(([bunkId, nodes]) => {
      if (!nodes || nodes.length === 0) return

      const bunkName = bunksData?.[parseInt(bunkId, 10)] ?? `Bunk ${bunkId}`
      // #31/#33: bunk label uses the same deterministic unit color as its bubble
      const bunkColor = getUnitColorForBunk(bunkName, allBunkNames)

      const labelEl = document.createElement('div')
      labelEl.className = 'bunk-label-popper'
      labelEl.style.position = 'absolute'
      labelEl.style.zIndex = '1'
      const innerDiv = document.createElement('div')
      Object.assign(innerDiv.style, {
        backgroundColor: bunkColor,
        color: 'white',
        padding: '4px 12px',
        borderRadius: '16px',
        fontSize: '12px',
        fontWeight: '600',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        whiteSpace: 'nowrap',
      })
      innerDiv.textContent = bunkName
      labelEl.appendChild(innerDiv)

      createPopperLabel(nodes, labelEl, containerRef, poppersRef, 10)
    })
  }

  // Update popper positions on graph viewport changes
  const updatePoppers = () => {
    poppersRef.current.forEach(({ instance }) => {
      void instance.update()
    })
  }

  cy.on('pan zoom resize', updatePoppers)

  // Initial visibility prime: Popper.js positions elements asynchronously
  // (its first layout runs on the next animation frame), so the visibility
  // modifier reading getBoundingClientRect() during createPopper sees the
  // unpositioned popper at (0,0) — which is "outside container" — and hides
  // the label. Without this, labels stay hidden until the user pans/zooms
  // and the existing listener triggers a re-update. Forcing an update on
  // the next frame primes correct visibility on initial draw.
  requestAnimationFrame(() => {
    updatePoppers()
  })
}

/**
 * Clear all bubble-related resources
 */
export function clearBubbles(refs: BubbleRenderRefs): void {
  const { bubblesetsRef, pathsRef, poppersRef } = refs

  if (bubblesetsRef.current) {
    ;(bubblesetsRef.current as { destroy: () => void }).destroy()
    bubblesetsRef.current = null
  }
  pathsRef.current = []

  if (poppersRef.current.length > 0) {
    poppersRef.current.forEach(({ element, instance }) => {
      instance.destroy()
      element.remove()
    })
    poppersRef.current = []
  }
}
