/**
 * Bunk bubble rendering utilities for Cytoscape social network graphs
 * Extracted from SocialNetworkGraph.tsx
 */
import type { Core, NodeSingular } from 'cytoscape'
import type { Instance as PopperInstance } from '@popperjs/core'
import { createPopper } from '@popperjs/core'
import { getBunkColor } from '../../utils/graphUtils'
import { getUnitForBunk, UNIT_COLORS } from '../../utils/unitMapping'

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
  showUnits: boolean = false
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

  // Collect unit grouping data (needed for both bubble paths and labels)
  let unitGroups: Record<string, NodeSingular[]> = {}
  let unitBunkColors: Record<string, string[]> = {}

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
        // Track unique bunk colors per unit for gradient labels
        const colors = (unitBunkColors[unit] ??= [])
        const bunkColor = getBunkColor(parseInt(String(bunkId), 10))
        if (!colors.includes(bunkColor)) {
          colors.push(bunkColor)
        }
      })
  }

  // --- Draw order: unit bubbles FIRST (behind), then bunk bubbles ON TOP ---

  // 1. Add unit bubble paths first so they render behind bunk bubbles
  if (showUnits && bunksData) {
    Object.entries(unitGroups).forEach(([unitName, nodes]) => {
      if (nodes.length === 0) return

      const unitColor = UNIT_COLORS[unitName] ?? '#888888'
      try {
        const nodeIds = nodes.map((n) => `#${n.id()}`).join(', ')
        const nodeCollection = cy.$(nodeIds)

        const path = (bb as { addPath: (...args: unknown[]) => SVGElement }).addPath(
          nodeCollection,
          cy.collection(),
          cy.collection(),
          {
            style: {
              fill: unitColor,
              fillOpacity: 0.15,
              stroke: unitColor,
              strokeOpacity: 0.7,
              strokeWidth: 3,
            },
            // Larger morphBuffer than bunk bubbles (35) so unit bubbles wrap outside them
            maxRoutingIterations: 100,
            morphBuffer: 120,
            threshold: 2,
            pixelGroup: 4,
            includeLabels: false,
            includeMainLabels: false,
            virtualEdges: true,
          }
        )
        pathsRef.current.push(path)
      } catch (error) {
        console.error(`Error creating unit bubble for ${unitName}:`, error)
      }
    })
  }

  // 2. Add bunk bubble paths on top of unit bubbles
  const renderedBunks: string[] = []
  const failedBunks: string[] = []

  Object.entries(bunkGroups).forEach(([bunkId, nodes]) => {
    if (!nodes || nodes.length === 0) return // Skip empty bunks

    const bunkName = bunksData?.[parseInt(bunkId)] ?? `Bunk ${bunkId}`
    const bunkColor = getBunkColor(parseInt(bunkId))

    try {
      // Create a bubble path for this bunk
      const nodeIds = nodes.map((n) => `#${n.id()}`).join(', ')
      const nodeCollection = cy.$(nodeIds)

      // Add path to the single bubbleset instance
      let path
      try {
        path = (bb as { addPath: (...args: unknown[]) => SVGElement }).addPath(
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
            maxRoutingIterations: 100,
            morphBuffer: 35,
            threshold: 2,
            pixelGroup: 4,
            includeLabels: false,
            includeMainLabels: false,
            virtualEdges: true,
          }
        )

        renderedBunks.push(`${bunkId} (${bunkName})`)
      } catch (pathError) {
        console.error(`Error creating path for bunk ${bunkId}:`, pathError)
        failedBunks.push(`${bunkId} (${bunkName}) - Error: ${String(pathError)}`)
        return
      }

      // Store the path reference with metadata
      pathsRef.current.push(path)
    } catch (error) {
      console.error(`Error creating bubble for bunk ${bunkId}:`, error)
      failedBunks.push(`${bunkId} (${bunkName}) - Error: ${String(error)}`)
    }
  })

  // Update UI state with rendering status
  if (updateStatus) {
    updateStatus({
      total: Object.keys(bunkGroups).length,
      rendered: renderedBunks.length,
      failed: failedBunks.length,
    })
  }

  // Force a render update to ensure bubbles are drawn
  try {
    ;(bb as { update: (force: boolean) => void }).update(true)
  } catch (updateError) {
    console.error('Error calling bb.update(true):', updateError)
  }

  // Force a render update to ensure bubbles are drawn
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

  // 3. Add unit labels with gradient bunk colors
  if (showUnits && bunksData) {
    Object.entries(unitGroups).forEach(([unitName, nodes]) => {
      if (nodes.length === 0) return

      const unitColor = UNIT_COLORS[unitName] ?? '#888888'
      const colors = unitBunkColors[unitName] ?? []

      const labelEl = document.createElement('div')
      labelEl.className = 'unit-label-popper'
      labelEl.style.position = 'absolute'
      labelEl.style.zIndex = '1'
      const innerDiv = document.createElement('div')

      // Use CSS gradient text if multiple bunk colors, otherwise use single bunk color
      if (colors.length >= 2) {
        const gradientStops = colors.join(', ')
        Object.assign(innerDiv.style, {
          background: `linear-gradient(90deg, ${gradientStops})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          padding: '2px 10px',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '700',
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
          border: `2px solid ${colors[0]}`,
          borderImage: `linear-gradient(90deg, ${gradientStops}) 1`,
          backgroundColor: 'rgba(255,255,255,0.85)',
        })
      } else {
        const labelColor = colors[0] ?? unitColor
        Object.assign(innerDiv.style, {
          color: labelColor,
          padding: '2px 10px',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '700',
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
          border: `2px solid ${labelColor}`,
          backgroundColor: 'rgba(255,255,255,0.85)',
        })
      }
      innerDiv.textContent = unitName
      labelEl.appendChild(innerDiv)

      createPopperLabel(nodes, labelEl, containerRef, poppersRef, 30)
    })
  }

  // 4. Add bunk labels using Popper
  Object.entries(bunkGroups).forEach(([bunkId, nodes]) => {
    if (!nodes || nodes.length === 0) return

    const bunkName = bunksData?.[parseInt(bunkId)] ?? `Bunk ${bunkId}`
    const bunkColor = getBunkColor(parseInt(bunkId))

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

  // Update popper positions on graph viewport changes
  const updatePoppers = () => {
    poppersRef.current.forEach(({ instance }) => {
      void instance.update()
    })
  }

  cy.on('pan zoom resize', updatePoppers)
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
