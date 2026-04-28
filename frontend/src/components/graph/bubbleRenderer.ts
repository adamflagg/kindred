/**
 * Bunk bubble rendering utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape'
import type { Instance as PopperInstance } from '@popperjs/core'
import { createPopper } from '@popperjs/core'
import { getUnitSideForBunk, type UnitSide } from '../../utils/unitMapping'
import { getUnitColorForBunk, getUnitColorByName } from '../../utils/graphColorUtils'

/** Lucide-derived path data for the gender side markers. Keeping the SVG
 *  inline (rather than rendering React lucide-react components) avoids
 *  spinning up a React tree just to extract markup for these DOM-based
 *  popper labels. The unicode glyphs (♂ / ♀) we used previously rendered
 *  too thin against the unit color stroke. */
const SIDE_MARKER_PATHS: Record<Exclude<UnitSide, null>, string> = {
  // Mars (♂): circle + diagonal arrow up-right
  B: '<path d="M16 3h5v5"/><path d="M21 3l-6.75 6.75"/><circle cx="10" cy="14" r="6"/>',
  // Venus (♀): circle + cross below
  G: '<path d="M12 16v6"/><path d="M9 19h6"/><circle cx="12" cy="9" r="6"/>',
}

/** Shared config for bubbleset path rendering (unit and bunk bubbles) */
const BASE_BUBBLE_OPTIONS = {
  maxRoutingIterations: 100,
  threshold: 2,
  pixelGroup: 4,
  includeLabels: false,
  includeMainLabels: false,
  virtualEdges: true,
} as const

/**
 * Options for BUNK bubbles. Tuned and validated by staff — do NOT change
 * morphBuffer or pixelGroup without re-validating; bunk bubble shape is
 * intentionally tight against the cluster (#32 spec lock).
 */
export function getBunkBubbleOptions(): {
  maxRoutingIterations: number
  threshold: number
  pixelGroup: number
  includeLabels: boolean
  includeMainLabels: boolean
  virtualEdges: boolean
  morphBuffer: number
} {
  return {
    ...BASE_BUBBLE_OPTIONS,
    morphBuffer: 35,
  }
}

/**
 * Options for UNIT bubbles (#32 spec lock 2026-04-24):
 *   (a) Clear whitespace gap (~20px) between unit boundary and the outer
 *       edge of the contained bunk bubbles. The bubbleset visual extent is
 *       controlled by `nodeR1`/`edgeR1` (energy-field falloff radius) and
 *       `threshold` (contour cutoff), NOT by morphBuffer alone — morphBuffer
 *       just sizes the marching-squares grid.
 *   (b) Smoother spline (Photoshop-feather aesthetic) → larger pixelGroup so
 *       marching squares quantizes the contour into fewer, longer segments.
 */
export function getUnitBubbleOptions(): {
  maxRoutingIterations: number
  threshold: number
  pixelGroup: number
  includeLabels: boolean
  includeMainLabels: boolean
  virtualEdges: boolean
  morphBuffer: number
  nodeR0: number
  nodeR1: number
  edgeR0: number
  edgeR1: number
} {
  return {
    ...BASE_BUBBLE_OPTIONS,
    // Lower threshold widens the energy-field contour beyond the nodes.
    // Bunk uses BASE_BUBBLE_OPTIONS.threshold = 2; unit halves it to push
    // the contour outward from the same node positions.
    threshold: 0.5,
    // upsetjs/bubblesets defaults are nodeR1=50 / edgeR1=20. Bunk bubbles
    // inherit those defaults, so to put ~20px of visible whitespace OUTSIDE
    // each bunk's contour, the unit's nodeR1/edgeR1 must be substantially
    // larger than 50/20 — not smaller.
    nodeR0: 20,
    nodeR1: 90,
    edgeR0: 20,
    edgeR1: 80,
    pixelGroup: 8,
    // morphBuffer just sizes the marching-squares grid — doesn't affect
    // visible extent. 30 is enough headroom for the larger nodeR1.
    morphBuffer: 30,
  }
}

/** Shared font styles for unit labels */
const UNIT_LABEL_FONT = {
  fontSize: '14px',
  fontWeight: '700',
  letterSpacing: '0.5px',
} as const

/**
 * Build the DOM for a unit label ("Galil" + ♂/♀ icon). Extracted as a
 * pure helper so the SVG-icon swap can be unit-tested without spinning
 * up a Cytoscape instance.
 */
export function buildUnitLabel(
  unit: string,
  side: Exclude<UnitSide, null>,
  unitColor: string
): HTMLElement {
  const labelEl = document.createElement('div')
  labelEl.className = 'unit-label-popper'
  labelEl.style.position = 'absolute'

  Object.assign(labelEl.style, {
    backgroundColor: 'rgba(255,255,255,0.85)',
    padding: '2px 10px',
    borderRadius: '10px',
    whiteSpace: 'nowrap',
    border: `2px solid ${unitColor}`,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  })

  const innerDiv = document.createElement('div')
  Object.assign(innerDiv.style, UNIT_LABEL_FONT)
  innerDiv.style.color = unitColor
  innerDiv.textContent = unit
  labelEl.appendChild(innerDiv)

  // Inline SVG so the marker paints with the same stroke color as the
  // unit border — no font-rendering anti-aliasing thinning the glyph.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', unitColor)
  svg.setAttribute('stroke-width', '2.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.innerHTML = SIDE_MARKER_PATHS[side]
  labelEl.appendChild(svg)

  return labelEl
}

/**
 * Pick the DOM parent for popper labels. Appending into the graph
 * container (instead of document.body) lets overflow:hidden clip labels
 * cleanly under the card header — and keeps them visible inside the
 * fixed-positioned card in fullscreen mode, where body-level labels
 * would be hidden behind the modal.
 */
export function getLabelParent(containerRef: { current: HTMLElement | null }): HTMLElement {
  return containerRef.current ?? document.body
}

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

  // Append into the graph container when one is available so the label
  // is clipped by overflow:hidden (slides cleanly under the card header)
  // and stays visible inside the fixed-positioned card in fullscreen
  // mode. Falls back to document.body only if the container isn't ready.
  getLabelParent(containerRef as { current: HTMLElement | null }).appendChild(labelEl)

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

  const boundary = containerRef.current ?? 'viewport'
  const popperInstance = createPopper(virtualElement as unknown as Element, labelEl, {
    placement: 'top',
    modifiers: [
      { name: 'offset', options: { offset: [0, offsetY] } },
      // Both flip and preventOverflow default to viewport boundary. In
      // fullscreen the card fills nearly the whole viewport, so viewport-
      // bound flipping would only trigger once the label crossed the
      // viewport edge — long past the header divider. Pinning both to the
      // graph container makes the label flip to below-the-node as soon as
      // there's no room above, matching the non-fullscreen behavior.
      { name: 'flip', options: { boundary, fallbackPlacements: ['bottom'] } },
      { name: 'preventOverflow', options: { boundary, altAxis: true } },
      {
        name: 'hideOutsideContainer',
        enabled: true,
        phase: 'main',
        fn({ state }) {
          const container = containerRef.current
          if (!container) return
          const containerRect = container.getBoundingClientRect()
          const popperRect = state.elements.popper.getBoundingClientRect()
          // Hide the moment the popper crosses any container edge — not
          // only when fully outside. With overflow:hidden on the container
          // a partially-outside label is already visually clipped at the
          // boundary; making it disappear cleanly avoids the half-cut
          // remnant peeking past the header divider in fullscreen.
          const isOutside =
            popperRect.top < containerRect.top ||
            popperRect.bottom > containerRect.bottom ||
            popperRect.left < containerRect.left ||
            popperRect.right > containerRect.right
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
    .filter((n) => !n.data('isBunkLabel') && !n.data('isBunkParent') && !n.data('isUnitParent'))
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

  // Collect unit grouping data (needed for both bubble paths and labels).
  // Keyed by `${unit}-${side}` so each unit gets two visual bubbles — boys
  // and girls — matching the layout split. AG and unprefixed Aleph/Bet have
  // side=null and don't appear in any unit bubble (free-floating).
  interface UnitSideEntry {
    unit: string
    side: 'B' | 'G'
    nodes: NodeSingular[]
  }
  const unitGroups: Record<string, UnitSideEntry> = {}

  if (showUnits && bunksData) {
    cy.nodes()
      .filter((n) => !n.data('isBunkLabel') && !n.data('isBunkParent') && !n.data('isUnitParent'))
      .forEach((node) => {
        const bunkId = node.data('bunk_cm_id')
        if (!bunkId) return
        const bunkName = bunksData[bunkId]
        if (!bunkName) return
        const unitSide = getUnitSideForBunk(bunkName)
        if (!unitSide?.side) return
        const key = `${unitSide.unit}-${unitSide.side}`
        const entry = (unitGroups[key] ??= { unit: unitSide.unit, side: unitSide.side, nodes: [] })
        entry.nodes.push(node)
      })
  }

  // --- Draw order: unit bubbles FIRST (behind), then bunk bubbles ON TOP ---

  // 1. Add unit bubble paths first so they render behind bunk bubbles
  if (showUnits && bunksData) {
    Object.entries(unitGroups).forEach(([key, { unit, nodes }]) => {
      if (nodes.length === 0) return

      // #31/#33: color depends ONLY on unit name, so Galil-B and Galil-G
      // share Galil's hue — the side split is for layout/labeling only.
      const unitColor = getUnitColorByName(unit)

      try {
        const nodeIds = nodes.map((n) => `#${n.id()}`).join(', ')
        const nodeCollection = cy.$(nodeIds)

        const path = addPath(nodeCollection, cy.collection(), cy.collection(), {
          style: getUnitBubbleStyle(unitColor),
          ...getUnitBubbleOptions(),
        })
        pathsRef.current.push(path)
      } catch (error) {
        console.error(`Error creating unit bubble for ${key}:`, error)
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
            ...getBunkBubbleOptions(),
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
  // One label per (unit, side): "Galil ♂" / "Galil ♀".
  if (showUnits && bunksData) {
    Object.values(unitGroups).forEach(({ unit, side, nodes }) => {
      if (nodes.length === 0) return

      const unitColor = getUnitColorByName(unit)
      const labelEl = buildUnitLabel(unit, side, unitColor)
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
