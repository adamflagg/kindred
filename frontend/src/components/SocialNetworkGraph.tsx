import { useEffect, useMemo, useRef, useState } from 'react'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose'
import BubbleSets from 'cytoscape-bubblesets'
// @ts-expect-error - No types available for cytoscape-svg
import cytoscapeSvg from 'cytoscape-svg'
import { useYear } from '../hooks/useCurrentYear'
import { useBunkNames } from '../hooks/useBunkNames'
import { Network } from 'lucide-react'
import { QueryGuard } from './QueryGuard'
import CamperDetailsPanel from './CamperDetailsPanel'
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
  getFcoseOptions,
  type PopperRef,
} from './graph'
import { cleanupPoppers, cleanupCytoscape } from '../hooks/graph'
import { useGraphFilter } from '../hooks/useGraphFilter'
import { useScopedGraphData } from '../hooks/useScopedGraphData'
import { GraphFilterButton, GraphFilterPopover, GraphFilterStatus } from './graph/filter'
import {
  parseFilterFromSearchParams,
  type BunkSummary,
  type FilterState,
} from './graph/graphFilter'
import {
  scopeToTab,
  tabToScope,
  type GenderTab,
  type BunkSummaryWithGender,
} from './graph/genderFilter'
import { useSearchParams } from 'react-router'
import { useLinkedAgSession } from '../hooks/useLinkedAgSession'
import { resolveEffectiveScope, shouldDegrade, genderBannerText } from './graph/graphScope'

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
  if (!cytoscape.prototype.svg) {
    cytoscape.use(cytoscapeSvg)
  }
  ;(globalThis as Record<symbol, boolean>)[EXTENSIONS_REGISTERED] = true
}

interface SocialNetworkGraphProps {
  sessionCmId: number
}

// Import worker types and lifecycle guards
import type { LayoutWorkerOutput } from '../workers/layoutWorker'
import { makeLayoutToken, isStaleLayoutMessage } from '../workers/layoutWorkerGuards'

// Module-level constant: request edges are always-on (not user-toggleable).
// Hoisted outside the component so the reference is stable across renders —
// passing a fresh object literal in deps arrays causes infinite re-renders.
const SHOW_EDGES = { request: true } as const

export default function SocialNetworkGraph({ sessionCmId }: SocialNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<cytoscape.Layouts | null>(null)
  const bubblesetsRef = useRef<unknown | null>(null)
  const pathsRef = useRef<SVGElement[]>([])
  const poppersRef = useRef<PopperRef[]>([])
  const poppersListenerRef = useRef<((evt?: unknown) => void) | null>(null)
  const layoutWorkerRef = useRef<Worker | null>(null)
  // First-run guard for the resize-on-expand effect: the init effect's
  // onLayoutComplete already calls cy.resize() + cy.fit(), so the
  // expand/collapse effect must skip its first run to avoid re-fitting
  // 200ms later against a possibly-different container size.
  const hasMountedExpandRef = useRef(false)
  /** Monotonically-increasing token issued per layout job.
   *  The worker echoes it back; stale responses (old token ≠ current) are dropped
   *  before they can call cy.batch() on a destroyed instance. */
  const layoutTokenRef = useRef<number>(0)
  useYear() // Ensure year context is available

  // Create refs object for bubble rendering - memoized to avoid recreation on every render
  const bubbleRefs = useMemo(
    () => ({ bubblesetsRef, pathsRef, poppersRef, containerRef, poppersListenerRef }),
    []
  )

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showBubbles, setShowBubbles] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showUnits, setShowUnits] = useState(true)
  const [isComputingLayout, setIsComputingLayout] = useState(false)

  // Read gender straight from the URL so dataSessionCmId can be computed before
  // useBunkNames (which needs it). useGraphFilter (below) is the write authority;
  // this is a read-only peek to break the hook-ordering cycle.
  const [rawSearchParams] = useSearchParams()
  const urlGender = parseFilterFromSearchParams(rawSearchParams).gender

  // Linked AG session (by parent_id). Gates the AG tab + provides its cm_id.
  const { agSessionCmId } = useLinkedAgSession(sessionCmId)
  const agAvailable = agSessionCmId != null

  // The session whose roster + graph we actually fetch: the AG session when the
  // AG tab is active, otherwise the current main session. (The `&& agSessionCmId`
  // guard means an 'ag' URL with no linked AG harmlessly stays on the main session.)
  const dataSessionCmId = urlGender === 'ag' && agSessionCmId ? agSessionCmId : sessionCmId

  // Bunk roster for the DATA session (used by the picker + as a label fallback).
  const { data: bunksData } = useBunkNames(dataSessionCmId, true)
  const allBunks: BunkSummary[] = useMemo(() => {
    if (!bunksData) return []
    return Object.entries(bunksData).map(([id, name]) => ({ cmId: Number(id), name: String(name) }))
  }, [bunksData])

  const allBunksWithGender: BunkSummaryWithGender[] = useMemo(() => {
    if (!bunksData) return []
    return Object.entries(bunksData).map(([id, name]) => ({
      cmId: Number(id),
      name: String(name),
      code: String(name).toLowerCase(),
    }))
  }, [bunksData])

  // Filter state from URL (write authority).
  const {
    filter,
    addUnit,
    removeUnit,
    addBunk,
    removeBunk,
    setGender,
    setEdgeMode,
    clear: clearFilter,
  } = useGraphFilter(allBunks)

  // Effective gender: if 'ag' is active without a linked AG session, fall back to 'all'.
  const gender = filter.gender === 'ag' && !agAvailable ? 'all' : filter.gender

  // Cabins dropped from the gender-derived set (ephemeral; reset on session/gender change).
  const [dropped, setDropped] = useState<Set<string>>(() => new Set())
  // True when an active scope yielded zero nodes and we fell back to the full graph.
  const [degraded, setDegraded] = useState(false)

  useEffect(() => {
    setDropped(new Set())
    setDegraded(false)
  }, [dataSessionCmId, gender])

  const resolved = useMemo(
    () =>
      resolveEffectiveScope({
        gender,
        manualUnits: filter.units,
        manualBunks: filter.bunks,
        dropped,
        roster: allBunksWithGender,
      }),
    [gender, filter.units, filter.bunks, dropped, allBunksWithGender]
  )

  // What we actually fetch: the resolved scope, or unscoped when degraded.
  const fetchFilter: FilterState = useMemo(
    () => ({
      units: degraded ? [] : resolved.units,
      bunks: degraded ? [] : resolved.bunks,
      gender: 'all',
      edgeMode: filter.edgeMode,
    }),
    [degraded, resolved, filter.edgeMode]
  )

  const {
    data: graphData,
    isLoading,
    error,
    isFetching,
  } = useScopedGraphData(dataSessionCmId, fetchFilter)

  // Graceful degradation: an active scope that resolves to zero nodes falls back
  // to the full graph for this data-session. URL keeps ?gender so the scoped view
  // self-restores on a session where that gender IS bunked.
  useEffect(() => {
    if (
      !degraded &&
      shouldDegrade({
        scopeActive: resolved.active,
        isLoading,
        hasError: error != null,
        nodeCount: graphData?.nodes.length ?? 0,
      })
    ) {
      setDegraded(true)
    }
  }, [degraded, resolved.active, isLoading, error, graphData])

  const degradeBanner = degraded ? genderBannerText(gender) : ''

  // Suppress the "no data" empty state while a non-empty graph is still coming:
  // (a) an active scope resolved to zero nodes and we're about to degrade, or
  // (b) we've degraded and the unscoped full-graph fetch is still in flight.
  // Without this, the degrade path briefly flashes the very "No social network
  // data available" message this feature exists to avoid. A genuinely empty
  // session (degraded, fetch settled, still zero nodes) correctly shows empty.
  const fallbackPending =
    error == null &&
    (graphData?.nodes.length ?? 0) === 0 &&
    ((resolved.active && !degraded) || (degraded && isFetching))

  // Compute the set of grades present in the current data for the legend
  const existingGrades = useMemo(() => {
    if (!graphData) return undefined
    const grades = new Set<number>()
    for (const node of graphData.nodes) {
      if (node.grade != null) grades.add(node.grade)
    }
    return grades.size > 0 ? grades : undefined
  }, [graphData])

  const [filterOpen, setFilterOpen] = useState(false)
  const filterButtonRef = useRef<HTMLButtonElement>(null)

  // selectedNodeId drives the camper detail panel (#35)

  // Derive the bunk roster for the selected camper so CamperDetailsPanel can
  // compute accurate unsatisfied-requests alerts (Issue #1061). Filter all
  // graph nodes to those sharing the selected camper's bunk_cm_id.
  const bunkCampers = useMemo(() => {
    if (!graphData || selectedNodeId == null) return undefined
    const selectedNode = graphData.nodes.find((n) => n.id === selectedNodeId)
    if (!selectedNode?.bunk_cm_id) return undefined
    return graphData.nodes
      .filter((n) => n.bunk_cm_id === selectedNode.bunk_cm_id)
      .map((n) => ({ cmId: n.id, grade: n.grade }))
  }, [graphData, selectedNodeId])

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

    // Note: we no longer wait for bunksData here. Parent (bunk) compound nodes
    // are created with placeholder labels (`Bunk {id}`) and patched in a
    // separate effect once bunksData arrives. This avoids a full graph
    // rebuild + worker re-run when bunk names finish loading after the
    // graph data — a major source of stale-token spinner stalls under
    // StrictMode (where each effect already double-invokes).

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

    // Create graph elements using extracted utility. When the user has
    // toggled "Show cross-scope edges", the API returns the boundary edges
    // and their out-of-scope endpoint nodes as separate lists — thread both
    // through so the renderer can ghost them (edge[?cross_scope] for edges,
    // node[?cross_scope] for nodes), and the ghost campers stay clickable
    // so users can open the detail panel for potential connections.
    const { parentNodes, nodes, edges } = createGraphElements(
      graphData.nodes,
      graphData.edges,
      bunksData,
      SHOW_EDGES,
      graphData.cross_scope_edges,
      graphData.cross_scope_nodes
    )

    // Single-shot batched add. The previous RAF-chunked staging approach added
    // ~500-800ms of pre-layout overhead (one RAF per 20-50 elements × N batches)
    // and forced cytoscape to re-run style application on every cy.add() call.
    // cy.batch() suppresses notifications/restyle until the end so a bulk add
    // is dramatically faster than incremental adds.
    const addAllElements = async () => {
      cy.batch(() => {
        // Order matters: parent compound nodes before children, edges last.
        cy.add(parentNodes as cytoscape.ElementDefinition[])
        cy.add(nodes as cytoscape.ElementDefinition[])
        updateEdgeVisibility(cy, SHOW_EDGES)
        cy.add(edges as cytoscape.ElementDefinition[])
      })
      // Yield once so React can paint a "Computing layout..." state before
      // the worker blocks the worker thread.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }

    const runLayout = () => {
      if (!cyRef.current) return
      const cy = cyRef.current

      // Post-layout completion handler.
      // Bubbles need a tick for the bubblesets DOM to settle so they're scheduled
      // on a microtask rather than a 500ms timer; node-label adjustment runs
      // synchronously alongside the cy.fit() call (see worker handler) so labels
      // don't visibly shift after the initial paint.
      const onLayoutComplete = () => {
        setIsComputingLayout(false)
        if ((showBubbles || showUnits) && bunksData) {
          // RAF lets cy emit its final pan/zoom events before bubbles snapshot
          // node positions, avoiding a stale draw.
          requestAnimationFrame(() => {
            if (cy.destroyed()) return
            try {
              clearBubbles(bubbleRefs)
              drawBunkBubbles(cy, bunksData, bubbleRefs, undefined, showUnits, showBubbles)
            } catch (error) {
              console.error('Error drawing bubbles:', error)
            }
          })
        }
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

        // Issue a new instance token for this layout job.
        // The worker echoes it back; if cy has been replaced before the
        // message arrives, the stale token prevents cy.batch() from running
        // against a destroyed instance (avoiding the endBatch → null.notify crash).
        layoutTokenRef.current = makeLayoutToken()
        // Capture our token in closure so we react only to OUR reply. The
        // worker is shared/long-lived across effect runs and fires every
        // response to ALL attached listeners; without this, an older listener
        // would inspect a newer listener's response (or vice versa), see the
        // wrong token, and detach itself — leaving no handler when the right
        // response finally arrives, which is what was stranding the spinner.
        const myToken = layoutTokenRef.current

        // Handle worker response
        const handleMessage = (event: MessageEvent<LayoutWorkerOutput & { token?: number }>) => {
          const { type, positions, error } = event.data
          const messageToken = event.data.token

          // Not our reply — another listener will handle it. Do NOT detach.
          if (messageToken !== myToken) return

          // It's our reply — detach now whatever happens next.
          worker.removeEventListener('message', handleMessage)

          // Our reply, but a newer layout job was issued before we came back.
          // Don't overwrite the newer state; the newer handler will clear the
          // spinner.
          if (isStaleLayoutMessage(myToken, layoutTokenRef.current)) {
            return
          }
          if (cy.destroyed()) {
            // Spinner safety net: cy was torn down between postMessage and reply
            // (StrictMode double-invoke or rapid effect re-runs). Clear the overlay
            // so the user isn't stuck on "Computing layout..." forever.
            setIsComputingLayout(false)
            return
          }

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
            // Resize before fitting so we measure against the actual container size —
            // without this, the initial fit can be calculated against a partially-laid-out
            // container, causing a slight off-center on first render that "snaps" when
            // the resize effect later fires (e.g. on first checkbox toggle).
            cy.resize()
            cy.fit(undefined, 50)
            // Adjust node-label positions synchronously after fit. Wrapped in a
            // batch so per-node text-margin-y mutations don't each trigger an
            // individual style recompute.
            cy.batch(() => {
              adjustLabelPositions(cy)
            })
            // Install graph event handlers AFTER the initial fit. The zoom
            // handler iterates every node and walks neighborhoods on each
            // event; if installed earlier, fit()'s zoom emission triggers it
            // mid-load and stacks on top of the post-layout work.
            setupGraphEventHandlers(cy, {
              onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
              onClearSelection: () => setSelectedNodeId(null),
            })
            onLayoutComplete()
          } else if (type === 'error') {
            console.error('[SocialNetworkGraph] Worker error:', error)
            runFallbackLayout()
          }
        }

        worker.addEventListener('message', handleMessage)
        // Stash the listener so the effect cleanup can detach it if the
        // component unmounts (or the effect re-runs) before our reply arrives.
        // Otherwise the shared worker keeps a closure ref to a dead cy.
        pendingWorkerListener = handleMessage
        worker.postMessage({ ...workerInput, token: layoutTokenRef.current })
      } catch (error) {
        console.warn('[SocialNetworkGraph] WebWorker failed, using main thread:', error)
        runFallbackLayout()
      }

      // Fallback layout on main thread (if worker fails). Uses the same
      // single-source-of-truth options as the worker path so layouts match.
      function runFallbackLayout() {
        const hasCompound = parentNodes.length > 0
        const layoutOpts = getFcoseOptions({ hasCompoundNodes: hasCompound })
        const layout = cy.layout(layoutOpts as cytoscape.LayoutOptions)
        layoutRef.current = layout
        layout.on('layoutstop', () => {
          setupGraphEventHandlers(cy, {
            onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
            onClearSelection: () => setSelectedNodeId(null),
          })
          onLayoutComplete()
        })
        layout.run()
      }
    } // End of runLayout function

    // Cancellation guard: prevent stale async work from applying to a newer graph
    // instance after this effect is cleaned up (e.g., deps change mid-build).
    let cancelled = false
    // Tracks the worker message listener for THIS effect's pending layout job.
    // Detached on cleanup so the long-lived shared worker doesn't keep a
    // closure reference to a destroyed cy.
    let pendingWorkerListener:
      | ((event: MessageEvent<LayoutWorkerOutput & { token?: number }>) => void)
      | null = null

    void addAllElements().then(() => {
      if (cancelled || !cyRef.current || cyRef.current !== cy || cy.destroyed()) return
      runLayout()
    })

    return () => {
      cancelled = true
      if (pendingWorkerListener && layoutWorkerRef.current) {
        layoutWorkerRef.current.removeEventListener('message', pendingWorkerListener)
        pendingWorkerListener = null
      }
      // Tear down the worker between layout jobs so each rebuild starts with
      // fresh fcose state. The worker module persists otherwise, and on this
      // codebase that has historically caused the second layout to crash
      // ("Cannot read properties of undefined") in fcose internals.
      layoutWorkerRef.current?.terminate()
      layoutWorkerRef.current = null
      cleanupCytoscape(cyRef, layoutRef, bubblesetsRef, poppersRef)
    }
    // showBubbles intentionally excluded: toggling bubbles is handled by the
    // resize/bubble effect below, avoiding a full graph rebuild + worker restart.
    // The closure reads showBubbles at effect-creation time to restore bubbles
    // after graph rebuilds triggered by other deps.
    //
    // bunksData intentionally excluded: it only supplies display names for
    // parent (bunk) compound nodes. A separate effect patches those labels
    // in place once bunksData arrives, avoiding a full graph rebuild +
    // worker re-run that previously caused stale-token spinner stalls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, showLabels, bubbleRefs])

  // Patch parent (bunk) compound node labels when bunksData arrives, without
  // tearing down the cytoscape instance or restarting the layout. Parent nodes
  // are initially created with `Bunk {id}` placeholders in createGraphElements;
  // here we replace those with real bunk names.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.destroyed() || !bunksData) return
    cy.batch(() => {
      cy.nodes()
        .filter((n) => n.data('isBunkParent'))
        .forEach((node) => {
          const bunkId = node.data('bunk_cm_id')
          const name = bunksData[bunkId]
          if (name) node.data('label', name)
        })
    })
  }, [bunksData])

  // Resize+fit the graph whenever the user toggles fullscreen. The init
  // effect's worker handler already does the initial resize+fit on first
  // load, so we skip the very first run of THIS effect (which fires on
  // mount alongside the init effect) — but every subsequent isExpanded
  // change runs a fresh resize+fit chained across three animation frames
  // so React's commit, the browser's CSS layout pass, and the paint all
  // settle before cytoscape reads the new container dimensions. Without
  // the multi-frame chain, toggling fullscreen immediately after initial
  // load could measure the still-transitioning container and leave the
  // graph laid out for the pre-fullscreen size (small, upper-left).
  useEffect(() => {
    if (!hasMountedExpandRef.current) {
      hasMountedExpandRef.current = true
      return
    }

    let cancelled = false
    const fitNow = () => {
      if (cancelled) return
      const cy = cyRef.current
      if (!cy || cy.destroyed()) return
      cy.resize()
      cy.fit(undefined, 50)
    }
    const rafIds: number[] = []
    rafIds.push(
      requestAnimationFrame(() => {
        rafIds.push(
          requestAnimationFrame(() => {
            rafIds.push(requestAnimationFrame(fitNow))
          })
        )
      })
    )

    return () => {
      cancelled = true
      rafIds.forEach(cancelAnimationFrame)
    }
  }, [isExpanded])

  // Separately, observe the container for non-toggle reflows (window
  // resize, sidebar open/close, devtools panel) so the graph stays fitted
  // even when isExpanded hasn't changed. Reads cyRef inline so a graph
  // rebuild swap doesn't leave a stale closure.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let rafId = 0
    let isInitialObservation = true
    const observer = new ResizeObserver(() => {
      if (isInitialObservation) {
        // Drop the initial observation (it fires synchronously when we
        // attach with the current size — that's not a "change").
        isInitialObservation = false
        return
      }
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const cy = cyRef.current
        if (!cy || cy.destroyed()) return
        cy.resize()
        cy.fit(undefined, 50)
      })
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [])

  // Bubble draw/clear when toggling Bunks/Units checkboxes OR when bunksData
  // first arrives. The init effect's onLayoutComplete only draws bubbles if
  // bunksData was already present at layout time; when bunksData arrives
  // after layout (the common case now that the init effect no longer waits
  // on it), this effect is the authority for drawing the initial bubbles.
  // drawBunkBubbles is idempotent (clearBubbles runs first), so even if init
  // already drew, the worst case is one redraw 200ms later — preferable to
  // the previous regression where bubbles silently never appeared until a
  // checkbox toggle.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.destroyed() || !bunksData) return

    const timeoutId = setTimeout(() => {
      if (!cy.destroyed()) {
        clearBubbles(bubbleRefs)
        if (showBubbles || showUnits) {
          drawBunkBubbles(cy, bunksData, bubbleRefs, undefined, showUnits, showBubbles)
        }
      }
    }, 200)

    return () => clearTimeout(timeoutId)
  }, [showBubbles, showUnits, bunksData, bubbleRefs])

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

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * ZOOM_SETTINGS.inMultiplier)
  }

  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * ZOOM_SETTINGS.outMultiplier)
  }

  const handleFit = () => {
    // Match the 50px padding the auto-fit (initial load + fullscreen
    // toggle) uses. Calling cy.fit() with no padding lets nodes hug the
    // container edges, where labels and bubbles get clipped under the
    // header divider, and the legend / controls overlap the corners of
    // the graph area.
    cyRef.current?.fit(undefined, 50)
  }

  const handleDownload = async (mode: 'fit' | 'viewport') => {
    const cy = cyRef.current
    const container = containerRef.current
    if (!cy || cy.destroyed() || !container) return
    const { exportSessionGraphPng } = await import('./graph/graphPngExport')
    const blob = await exportSessionGraphPng(cy, container, mode)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `social_network_session_${sessionCmId}.png`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExpandToggle = () => {
    setIsExpanded(!isExpanded)
  }

  const toggleLabels = () => {
    setShowLabels(!showLabels)
    // The useEffect on [showLabels] handles the cy.style update.
  }

  return (
    <QueryGuard
      isLoading={isLoading || fallbackPending}
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
            <div className="border-border relative z-30 border-b px-4 py-2">
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

                {/* Gender / AG tab selector — desktop only (mobile support removed project-wide) */}
                {allBunksWithGender.length > 0 && (
                  <div
                    role="group"
                    aria-label="Filter by gender"
                    className="hidden shrink-0 items-center gap-0.5 xl:flex"
                  >
                    {(['All', 'Boys', 'Girls'] as GenderTab[])
                      .concat(agAvailable ? ['AG'] : [])
                      .map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => {
                            setDropped(new Set())
                            setGender(tabToScope(tab))
                          }}
                          className={clsx(
                            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                            scopeToTab(gender) === tab
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                          aria-pressed={scopeToTab(gender) === tab}
                        >
                          {tab}
                        </button>
                      ))}
                  </div>
                )}

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
                  onDownload={handleDownload}
                  filterButton={
                    <div className="relative">
                      <GraphFilterButton
                        ref={filterButtonRef}
                        count={filter.units.length + filter.bunks.length}
                        open={filterOpen}
                        onToggle={() => setFilterOpen((v) => !v)}
                      />
                      <GraphFilterPopover
                        open={filterOpen}
                        onClose={() => setFilterOpen(false)}
                        triggerRef={filterButtonRef}
                        selectedUnits={filter.units}
                        selectedBunks={filter.bunks}
                        allBunks={allBunks}
                        edgeMode={filter.edgeMode}
                        onAddUnit={addUnit}
                        onRemoveUnit={removeUnit}
                        onAddBunk={addBunk}
                        onRemoveBunk={removeBunk}
                        onSetEdgeMode={setEdgeMode}
                        onClear={clearFilter}
                      />
                    </div>
                  }
                />
              </div>
            </div>

            {degradeBanner && (
              <div
                role="status"
                className="border-border flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <span aria-hidden>⚠</span>
                {degradeBanner}
              </div>
            )}

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

              <GraphFilterStatus
                unitCount={filter.units.length}
                bunkCount={filter.bunks.length}
                onClick={() => setFilterOpen(true)}
              />

              <GraphLegend {...(existingGrades ? { existingGrades } : {})} />
            </div>

            {showHelp && <GraphHelp />}
          </div>

          {/* Camper detail panel — opens when a node is tapped (#35). */}
          {selectedNodeId != null && (
            <CamperDetailsPanel
              camperId={selectedNodeId.toString()}
              onClose={() => setSelectedNodeId(null)}
              {...(bunkCampers != null && { bunkCampers })}
            />
          )}
        </>
      )}
    </QueryGuard>
  )
}
