import { useEffect, useMemo, useRef, useState } from 'react'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose'
import BubbleSets from 'cytoscape-bubblesets'
import { useYear } from '../hooks/useCurrentYear'
import { useBunkNames } from '../hooks/useBunkNames'
import { useSocialGraphData } from '../hooks/useSocialGraphData'
import { Network, AlertCircle } from 'lucide-react'
import { QueryGuard } from './QueryGuard'
import clsx from 'clsx'
import {
  ZOOM_SETTINGS,
  GraphControls,
  GraphLegend,
  GraphHelp,
  drawBunkBubbles,
  clearBubbles,
  adjustLabelPositions,
  updateEdgeVisibility,
  getCytoscapeStyles,
  createGraphElements,
  prepareWorkerInput,
  setupGraphEventHandlers,
  getLayoutOptions,
  type BubbleRenderStatus,
  type PopperRef,
} from './graph'
import { batchElements, cleanupPoppers, cleanupCytoscape } from '../hooks/graph'

// Register extensions only once (survives HMR reloads)
// Use a symbol on globalThis to track registration across module reloads
const EXTENSIONS_REGISTERED = Symbol.for('cytoscape-extensions-registered')
if (!(globalThis as Record<symbol, boolean>)[EXTENSIONS_REGISTERED]) {
  if (!cytoscape.prototype.fcose) {
    cytoscape.use(fcose)
  }
  if (!cytoscape.prototype.bubbleSets) {
    cytoscape.use(BubbleSets)
  }
  ;(globalThis as Record<symbol, boolean>)[EXTENSIONS_REGISTERED] = true
}

interface SocialNetworkGraphProps {
  sessionCmId: number
}

// Import worker types
import type { LayoutWorkerOutput } from '../workers/layoutWorker'

// Module-level constant: request + sibling edges are always-on (not user-toggleable).
// Hoisted outside the component so the reference is stable across renders —
// passing a fresh object literal in deps arrays causes infinite re-renders.
const SHOW_EDGES = { request: true, sibling: true } as const

export default function SocialNetworkGraph({ sessionCmId }: SocialNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<cytoscape.Layouts | null>(null)
  const bubblesetsRef = useRef<unknown | null>(null)
  const pathsRef = useRef<SVGElement[]>([])
  const poppersRef = useRef<PopperRef[]>([])
  const layoutWorkerRef = useRef<Worker | null>(null)
  useYear() // Ensure year context is available

  // Create refs object for bubble rendering - memoized to avoid recreation on every render
  const bubbleRefs = useMemo(() => ({ bubblesetsRef, pathsRef, poppersRef, containerRef }), [])

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showBubbles, setShowBubbles] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showUnits, setShowUnits] = useState(true)
  const [isComputingLayout, setIsComputingLayout] = useState(false)
  const [bubbleRenderStatus, setBubbleRenderStatus] = useState<BubbleRenderStatus | null>(null)

  // Fetch graph and bunk data using custom hooks
  const { data: graphData, isLoading, error } = useSocialGraphData(sessionCmId)

  // Compute the set of grades present in the current data for the legend
  const existingGrades = useMemo(() => {
    if (!graphData) return undefined
    const grades = new Set<number>()
    for (const node of graphData.nodes) {
      if (node.grade != null) grades.add(node.grade)
    }
    return grades.size > 0 ? grades : undefined
  }, [graphData])
  const { data: bunksData } = useBunkNames(sessionCmId, !!graphData)

  // Suppress unused variable warning - selectedNodeId used for future features
  void selectedNodeId

  // Handle escape key for expanded mode
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isExpanded])

  // Initialize Cytoscape
  useEffect(() => {
    // Clean up any existing instances before creating new ones
    cleanupPoppers(poppersRef)

    // Always use main container for initial render - isExpanded switching handled by separate effect
    const targetContainer = containerRef.current
    if (!targetContainer || !graphData) return

    // Wait for bunk names to load before rendering
    if (!bunksData && graphData.nodes.some((n) => n.bunk_cm_id)) {
      return
    }

    // Destroy existing instance when switching views
    if (cyRef.current) {
      if (layoutRef.current && typeof layoutRef.current.stop === 'function') {
        layoutRef.current.stop()
      }
      cyRef.current.destroy()
      cyRef.current = null
    }

    const cy = cytoscape({
      container: targetContainer,
      layout: { name: 'preset' }, // Prevent default grid layout
      style: getCytoscapeStyles({ showLabels }),
      panningEnabled: true,
      userPanningEnabled: true,
      zoomingEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.1,
      maxZoom: 10,
    })

    cyRef.current = cy

    // Create graph elements using extracted utility
    const { parentNodes, nodes, edges } = createGraphElements(
      graphData.nodes as Parameters<typeof createGraphElements>[0],
      graphData.edges as Parameters<typeof createGraphElements>[1],
      bunksData,
      SHOW_EDGES
    )

    // Staged rendering for smoother loading
    const stageElements = async (
      elements: cytoscape.ElementDefinition[],
      batchSize: number = 50
    ) => {
      const batches = batchElements(elements, batchSize)
      for (const batch of batches) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            cy.add(batch)
            resolve()
          })
        })
      }
    }

    // Add elements in stages
    const addElementsStaged = async () => {
      // Add parent (bunk) nodes - required for compound layout grouping
      await stageElements(parentNodes as cytoscape.ElementDefinition[], 20)

      // Add child (camper) nodes
      await stageElements(nodes as cytoscape.ElementDefinition[], 30)

      // Apply edge visibility before adding edges
      updateEdgeVisibility(cy, SHOW_EDGES)

      // Add edges last in larger batches
      await stageElements(edges as cytoscape.ElementDefinition[], 50)
    }

    const runLayout = () => {
      if (!cyRef.current) return
      const cy = cyRef.current

      // Post-layout completion handler
      const onLayoutComplete = () => {
        setIsComputingLayout(false)
        setTimeout(() => {
          try {
            adjustLabelPositions(cy)
            // Redraw bubbles after layout if enabled (showBubbles is read from
            // the closure at effect-creation time, which is correct — if bubbles
            // were on when the graph rebuilt, they should be restored).
            if ((showBubbles || showUnits) && bunksData) {
              clearBubbles(bubbleRefs)
              drawBunkBubbles(
                cy,
                bunksData,
                bubbleRefs,
                setBubbleRenderStatus,
                showUnits,
                showBubbles
              )
            }
          } catch (error) {
            console.error('Error after layout complete:', error)
          }
        }, 500)
      }

      // Prepare data for worker
      const workerInput = prepareWorkerInput(parentNodes, nodes, edges)

      // Try to use WebWorker for layout computation
      try {
        setIsComputingLayout(true)

        // Create worker if not exists
        layoutWorkerRef.current ??= new Worker(
          new URL('../workers/layoutWorker.ts', import.meta.url),
          { type: 'module' }
        )

        const worker = layoutWorkerRef.current

        // Handle worker response
        const handleMessage = (event: MessageEvent<LayoutWorkerOutput>) => {
          const { type, positions, error } = event.data

          if (type === 'positions' && positions) {
            // Apply positions to visible graph
            cy.batch(() => {
              Object.entries(positions).forEach(([nodeId, pos]) => {
                const node = cy.getElementById(nodeId)
                if (node.length > 0) {
                  node.position(pos)
                }
              })
            })
            cy.fit(undefined, 80)
            onLayoutComplete()
          } else if (type === 'error') {
            console.error('[SocialNetworkGraph] Worker error:', error)
            // Fallback to main thread layout
            runFallbackLayout()
          }

          // Remove listener after handling
          worker.removeEventListener('message', handleMessage)
        }

        worker.addEventListener('message', handleMessage)
        worker.postMessage(workerInput)
      } catch (error) {
        console.warn('[SocialNetworkGraph] WebWorker failed, using main thread:', error)
        runFallbackLayout()
      }

      // Fallback layout on main thread (if worker fails)
      function runFallbackLayout() {
        const hasCompound = parentNodes.length > 0
        const layoutOpts = getLayoutOptions({ hasCompoundNodes: hasCompound })
        const layout = cy.layout(layoutOpts as cytoscape.LayoutOptions)
        layoutRef.current = layout
        layout.on('layoutstop', onLayoutComplete)
        layout.run()
      }

      // Setup event handlers using extracted utility
      setupGraphEventHandlers(cy, {
        onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
        onClearSelection: () => setSelectedNodeId(null),
      })
    } // End of runLayout function

    // Cancellation guard: prevent stale async work from applying to a newer graph
    // instance after this effect is cleaned up (e.g., deps change mid-build).
    let cancelled = false

    // Start staged addition
    void addElementsStaged().then(() => {
      if (cancelled || !cyRef.current || cyRef.current !== cy || cy.destroyed()) return
      // Run layout after all elements are added
      runLayout()
    })

    return () => {
      cancelled = true
      cleanupCytoscape(cyRef, layoutRef, bubblesetsRef, poppersRef)
    }
    // showBubbles intentionally excluded: toggling bubbles is handled by the
    // resize/bubble effect below, avoiding a full graph rebuild + worker restart.
    // The closure reads showBubbles at effect-creation time to restore bubbles
    // after graph rebuilds triggered by other deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, bunksData, showLabels, bubbleRefs])

  // Handle resize when expanding/collapsing - container stays the same, just resizes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.destroyed()) return

    // Longer delay to allow CSS layout to stabilize in expanded mode
    const timeoutId = setTimeout(() => {
      if (!cy.destroyed()) {
        cy.resize()
        cy.fit(undefined, 50)

        // Redraw bubbles after resize if enabled
        if ((showBubbles || showUnits) && bunksData) {
          // Clear existing bubblesets using the utility
          clearBubbles(bubbleRefs)
          drawBunkBubbles(cy, bunksData, bubbleRefs, setBubbleRenderStatus, showUnits, showBubbles)
        } else if (!showBubbles && !showUnits) {
          clearBubbles(bubbleRefs)
        }
      }
    }, 200)

    return () => clearTimeout(timeoutId)
  }, [isExpanded, showBubbles, showUnits, bunksData, bubbleRefs])

  // Update labels without re-rendering the whole graph
  useEffect(() => {
    if (cyRef.current) {
      cyRef.current
        .style()
        .selector('node')
        .style('label', showLabels ? 'data(label)' : '')
        .update()
    }
  }, [showLabels])

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (layoutWorkerRef.current) {
        layoutWorkerRef.current.terminate()
        layoutWorkerRef.current = null
      }
    }
  }, [])

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * ZOOM_SETTINGS.inMultiplier)
  }

  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * ZOOM_SETTINGS.outMultiplier)
  }

  const handleFit = () => {
    cyRef.current?.fit()
  }

  const handleExpandToggle = () => {
    setIsExpanded(!isExpanded)
  }

  const toggleLabels = () => {
    setShowLabels(!showLabels)
    if (cyRef.current) {
      cyRef.current
        .style()
        .selector('node')
        .style('label', !showLabels ? 'data(label)' : '')
        .update()
    }
  }

  return (
    <QueryGuard
      isLoading={isLoading}
      error={error}
      data={graphData?.nodes.length ? graphData : undefined}
      label="social network"
      emptyMessage={graphData?.warnings?.[0] ?? 'No social network data available'}
    >
      {() => (
        <>
          {/* Backdrop - only shown when expanded */}
          {isExpanded && (
            <div className="fixed inset-0 z-40 bg-black/50" onClick={handleExpandToggle} />
          )}

          {/* Main container - card style when normal, fixed fullscreen when expanded */}
          <div
            className={clsx(
              'flex flex-col overflow-hidden',
              isExpanded
                ? 'bg-card border-border shadow-lodge-xl fixed inset-4 z-50 rounded-2xl border'
                : 'card-lodge'
            )}
          >
            <div className="border-border relative z-20 border-b px-4 py-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-foreground flex min-w-0 shrink items-center gap-2 font-semibold">
                  <Network className="text-primary h-5 w-5 shrink-0" />
                  <span className="truncate">
                    Social Network Graph{isExpanded ? ' - Expanded View' : ''}
                  </span>
                </h3>

                {/* Bunks / Units toggles — inline in header top row */}
                <div
                  role="group"
                  aria-label="Show / Hide"
                  className="flex shrink-0 items-center justify-center gap-3 text-sm"
                >
                  <span className="text-muted-foreground font-bold">Show / Hide</span>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showBubbles}
                      onChange={(e) => setShowBubbles(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-muted-foreground">Bunks</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showUnits}
                      onChange={(e) => setShowUnits(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-muted-foreground">Units</span>
                  </label>
                </div>

                <GraphControls
                  showLabels={showLabels}
                  onToggleLabels={toggleLabels}
                  showHelp={showHelp}
                  onToggleHelp={() => setShowHelp(!showHelp)}
                  isExpanded={isExpanded}
                  onToggleExpand={handleExpandToggle}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onFit={handleFit}
                />
              </div>
            </div>

            {/* Graph container - ALWAYS in same tree position */}
            {/* Mobile-responsive: min-h-[50vh] on mobile, h-[600px] on desktop */}
            <div
              className={clsx(
                'relative',
                isExpanded
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'h-[50vh] min-h-[50vh] sm:h-[60vh] lg:h-[600px]'
              )}
            >
              <div
                ref={containerRef}
                className={clsx('overflow-hidden', isExpanded ? 'w-full flex-1' : 'h-full w-full')}
              />

              {/* Layout Computing Overlay */}
              {isComputingLayout && (
                <div className="bg-card/80 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3">
                    <div className="spinner-lodge h-8 w-8" />
                    <div className="text-muted-foreground text-sm">Computing layout...</div>
                  </div>
                </div>
              )}

              {/* Bubble Render Status — only meaningful when bubbles are actually requested */}
              {(showBubbles || showUnits) &&
                bubbleRenderStatus &&
                bubbleRenderStatus.rendered < bubbleRenderStatus.total && (
                  <div className="shadow-lodge-sm absolute top-4 left-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <AlertCircle className="h-4 w-4" />
                      <span className="font-medium">Bubble Rendering Issue</span>
                    </div>
                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      Only {bubbleRenderStatus.rendered} of {bubbleRenderStatus.total} bunk bubbles
                      rendered. This is a known library limitation. The graph is still fully
                      functional.
                    </div>
                  </div>
                )}

              <GraphLegend {...(existingGrades ? { existingGrades } : {})} />
            </div>

            {showHelp && <GraphHelp />}
          </div>
        </>
      )}
    </QueryGuard>
  )
}
