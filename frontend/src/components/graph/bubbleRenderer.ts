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

  // Track which bunks successfully render
  const renderedBunks: string[] = []
  const failedBunks: string[] = []

  // Add paths for each bunk
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

  // Add bunk labels using Popper
  Object.entries(bunkGroups).forEach(([bunkId, nodes]) => {
    if (!nodes || nodes.length === 0) return

    const bunkName = bunksData?.[parseInt(bunkId)] ?? `Bunk ${bunkId}`
    const bunkColor = getBunkColor(parseInt(bunkId))

    // Find the topmost node in the bunk to position label above it
    let topmostNode = nodes[0]
    if (!topmostNode) return

    let minY = topmostNode.position().y

    nodes.forEach((node) => {
      if (node.position().y < minY) {
        minY = node.position().y
        topmostNode = node
      }
    })

    // Create label element
    const labelEl = document.createElement('div')
    labelEl.className = 'bunk-label-popper'
    labelEl.style.position = 'absolute'
    labelEl.style.zIndex = '10'
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
    document.body.appendChild(labelEl)

    // Create virtual element for Popper that tracks the node position
    const virtualElement = {
      getBoundingClientRect: () => {
        const pos = topmostNode?.renderedPosition() ?? { x: 0, y: 0 }
        const containerRect = containerRef.current?.getBoundingClientRect()

        if (!containerRect) {
          return {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            width: 0,
            height: 0,
            x: 0,
            y: 0,
          }
        }

        // Convert from Cytoscape coordinates to page coordinates
        const x = containerRect.left + pos.x
        const y = containerRect.top + pos.y

        return {
          top: y,
          bottom: y,
          left: x,
          right: x,
          width: 0,
          height: 0,
          x: x,
          y: y,
          toJSON: () => ({
            top: y,
            bottom: y,
            left: x,
            right: x,
            width: 0,
            height: 0,
          }),
        } as DOMRect
      },
    }

    // Create popper instance
    const popperInstance = createPopper(virtualElement as unknown as Element, labelEl, {
      placement: 'top',
      modifiers: [
        {
          name: 'offset',
          options: {
            offset: [0, 10],
          },
        },
        {
          name: 'preventOverflow',
          options: {
            boundary: 'viewport',
          },
        },
      ],
    })

    // Store reference for cleanup
    poppersRef.current.push({ element: labelEl, instance: popperInstance })
  })

  // Draw unit-level outline bubbles when units are enabled
  if (showUnits && bunksData) {
    // Group nodes by unit
    const unitGroups: Record<string, NodeSingular[]> = {}
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

    // Create outline-only bubble paths for each unit
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
              fillOpacity: 0,
              stroke: unitColor,
              strokeOpacity: 0.6,
              strokeWidth: 2,
            },
            maxRoutingIterations: 100,
            morphBuffer: 55,
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

      // Create unit label above the group
      let topmostNode = nodes[0]
      if (!topmostNode) return
      let minY = topmostNode.position().y
      nodes.forEach((node) => {
        if (node.position().y < minY) {
          minY = node.position().y
          topmostNode = node
        }
      })

      const labelEl = document.createElement('div')
      labelEl.className = 'unit-label-popper'
      labelEl.style.position = 'absolute'
      labelEl.style.zIndex = '8'
      const innerDiv = document.createElement('div')
      Object.assign(innerDiv.style, {
        color: unitColor,
        padding: '2px 10px',
        borderRadius: '10px',
        fontSize: '14px',
        fontWeight: '700',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
        border: `2px solid ${unitColor}`,
        backgroundColor: 'rgba(255,255,255,0.85)',
      })
      innerDiv.textContent = unitName
      labelEl.appendChild(innerDiv)
      document.body.appendChild(labelEl)

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
          { name: 'offset', options: { offset: [0, 30] } },
          { name: 'preventOverflow', options: { boundary: 'viewport' } },
        ],
      })
      poppersRef.current.push({ element: labelEl, instance: popperInstance })
    })

    // Re-trigger bubbleset update to include unit paths
    try {
      ;(bb as { update: (force: boolean) => void }).update(true)
    } catch {
      // ignore
    }
  }

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
