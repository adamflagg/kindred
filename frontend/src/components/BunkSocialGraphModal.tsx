import { useEffect, useMemo, useRef, useState, Activity } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose'
// @ts-expect-error - No types available for cytoscape-cola
import cola from 'cytoscape-cola'
// Tooltips removed - will implement React-based solution
import {
  Network,
  X,
  AlertTriangle,
  Users,
  Activity as ActivityIcon,
  Download,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Info,
} from 'lucide-react'
import clsx from 'clsx'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import {
  BUNK_NODE_COLORS,
  CROSS_SCOPE_NODE_COLOR,
  FIRST_YEAR_RING_COLOR,
  buildBunkColaLayoutOptions,
  buildBunkGraphElements,
  getBunkCytoscapeStyles,
  getBunkGradeColors,
} from './bunkGraphStyles'
import { EDGE_COLORS } from './graph/constants'
import { socialGraphService } from '../services/socialGraph'
import { graphCacheService } from '../services/GraphCacheService'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { useScenario } from '../hooks/useScenario'
import CamperDetailsPanel from './CamperDetailsPanel'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import type { Bunk, Session } from '../types/app-types'
import type { BunkPlansResponse, BunksResponse } from '../types/pocketbase-types'

// Register extensions
cytoscape.use(fcose)
cytoscape.use(cola)

interface BunkSocialGraphModalProps {
  bunkCmId: number
  bunkName: string
  sessionCmId: number
  year: number
  isOpen: boolean
  onClose: () => void
  onBunkChange?: (bunkCmId: number, bunkName: string) => void
}

interface GraphNode {
  id: number
  name: string
  grade: number | null
  bunk_cm_id: number | null
  centrality: number
  clustering: number
  community: number | null
  first_year?: boolean
  last_year_session?: string | null
  last_year_bunk?: string | null
  /** Current bunk name — populated for cross-scope ghost nodes. */
  bunk_name?: string | null
}

interface GraphEdge {
  source: number
  target: number
  weight: number
  edge_type: string
  // The backend (build_bunk_graph) collapses reciprocal pairs into a single
  // edge with this flag set, so the frontend never sees two mirror edges. The
  // cytoscape stylesheet reads it to render the bold solid double-headed
  // line for mutual requests (#1309).
  reciprocal: boolean
  confidence?: number
  // `not_bunk_with` requests ship from the API with edge_type='request' (same
  // as positive bunk_with) and are distinguished only by request_type — the
  // shared `resolveEdgeColor` helper consults this field to pick the red hue.
  request_type?: string | null
}

interface BunkGraphMetrics {
  cohesion_score: number
  average_degree: number
  density: number
  isolated_count: number
  suggestions: string[]
}

interface BunkGraphData {
  bunk_cm_id: number
  bunk_name: string
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  metrics: BunkGraphMetrics
  health_score: number
  /** Populated when ?cross_scope=true — edges that cross outside this bunk. */
  readonly cross_scope_edges?: ReadonlyArray<{
    source: number
    target: number
    edge_type: 'request'
    weight: number
    request_type: string | null
    confidence: number | null
    reciprocal: boolean
    cross_scope: true
  }>
  /** Populated when ?cross_scope=true — ghost nodes (out-of-scope endpoints). */
  readonly cross_scope_nodes?: readonly GraphNode[]
}

// Bunk-naming predicates live in `utils/bunkNaming` so utility modules
// (e.g. bunkSwap) can import them without depending on this component.
import { getBunkType, extractSortKey, isAGBunkName } from '../utils/bunkNaming'

/**
 * Build a PocketBase filter for fetching bunks by cm_id within a specific year.
 *
 * The bunks table stores one row per (cm_id, year) for history retention.
 * Omitting the year clause returns ~N years of duplicate rows per logical
 * bunk, which seeds the navigation list with adjacent same-cm_id entries
 * and silently no-ops next/prev (#1339 audit follow-up).
 *
 * Returns an empty string for an empty cm_id list — callers should short-
 * circuit before invoking.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const buildBunksFilter = (cmIds: number[], year: number): string => {
  if (cmIds.length === 0) return ''
  const clause = cmIds.map((id) => `cm_id = ${id}`).join(' || ')
  return `(${clause}) && year = ${year}`
}

/**
 * Extract bunk cm_ids from a list of expanded bunk_plans records.
 *
 * `bunk_plans` schema (per `pocketbase/pb_migrations/1500000017_bunk_plans.js`)
 * has no flat `bunk_cm_id` column — the bunk reference is the `bunk` relation
 * field, and the bunk's CM ID is reached via `expand.bunk.cm_id` when the
 * caller requests `expand: 'bunk'`. A previous inline interface assumed a
 * flat `bunk_cm_id` field which doesn't exist; the resulting always-empty
 * array silently hid prev/next navigation in the bunk social graph modal
 * (#1339 audit).
 */
// eslint-disable-next-line react-refresh/only-export-components
export const extractBunkCmIdsFromPlans = (
  bunkPlans: Array<{ expand?: { bunk?: { cm_id?: number } } }>
): number[] => [
  ...new Set(
    bunkPlans
      .map((bp) => bp.expand?.bunk?.cm_id)
      .filter((id): id is number => typeof id === 'number')
  ),
]

export default function BunkSocialGraphModal({
  bunkCmId,
  bunkName,
  sessionCmId,
  year,
  isOpen,
  onClose,
  onBunkChange,
}: BunkSocialGraphModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<cytoscape.Layouts | null>(null)
  const { fetchWithAuth } = useApiWithAuth()
  const { currentScenario } = useScenario()
  const scenarioId = currentScenario?.id ?? null
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [showLegend, setShowLegend] = useState<boolean>(false)
  const [showCrossScopeEdges, setShowCrossScopeEdges] = useState<boolean>(false)

  // Fetch bunk graph data. The query key and the in-memory graph cache both
  // include scenarioId AND showCrossScopeEdges so scenario-sourced graphs and
  // cross-scope graphs never collide with their plain/production counterparts.
  // The cross-scope flag must reach getBunkGraph's cache key — keying it only on
  // the React Query side let this inner LRU serve the stale plain graph on the
  // open-then-toggle path, so cross-scope edges never rendered (#1606/#1610).
  const { data: graphData, isLoading } = useQuery<BunkGraphData>({
    queryKey: [
      ...queryKeys.bunkSocialGraph(bunkCmId, sessionCmId, year, scenarioId),
      showCrossScopeEdges,
    ],
    queryFn: async () => {
      const data = await graphCacheService.getBunkGraph(
        bunkCmId,
        sessionCmId,
        async () => {
          return socialGraphService.getBunkSocialGraph(
            bunkCmId,
            sessionCmId,
            year,
            fetchWithAuth,
            scenarioId,
            showCrossScopeEdges
          )
        },
        year,
        scenarioId,
        showCrossScopeEdges
      )
      return data as unknown as BunkGraphData
    },
    enabled: isOpen,
  })

  // Derive bunk roster for CamperDetailsPanel so it can compute accurate
  // unsatisfied-requests alerts (Issue #1061). Since this modal is scoped to
  // a single bunk, every node in graphData IS a bunkmate.
  const bunkCampers = useMemo(
    () => graphData?.nodes.map((n) => ({ cmId: n.id, grade: n.grade })) ?? undefined,
    [graphData]
  )

  // Fetch session bunks for navigation
  const { data: allBunks } = useQuery({
    queryKey: ['session-bunks', sessionCmId, year],
    queryFn: async () => {
      // Get the session by CampMinder ID and year
      const sessionResp = await pb.collection<Session>('camp_sessions').getList(1, 1, {
        filter: `cm_id = ${sessionCmId} && year = ${year}`,
      })

      if (sessionResp.items.length === 0) {
        throw new Error(`Session with CampMinder ID ${sessionCmId} not found for year ${year}`)
      }

      const session = sessionResp.items[0]!

      // Get bunk plans for this session using relation expansion
      const filter = `session.cm_id = ${session.cm_id} && year = ${year}`
      const bunkPlans = await pb
        .collection('bunk_plans')
        .getFullList<BunkPlansResponse<{ bunk: BunksResponse }>>({
          filter,
          expand: 'bunk',
        })

      if (bunkPlans.length === 0) return []

      const bunkCmIds = extractBunkCmIdsFromPlans(bunkPlans)
      if (bunkCmIds.length === 0) return []

      const bunkFilter = buildBunksFilter(bunkCmIds, year)
      const bunks = await pb.collection<Bunk>('bunks').getFullList({ filter: bunkFilter })

      // Sort bunks by name
      return bunks.sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: isOpen,
  })

  // Pure derivation: same-type bunks sorted by level, plus the current
  // bunk's index within that list. Recomputed on bunkCmId / allBunks change;
  // navigation flows through onBunkChange → bunkCmId, which re-derives.
  const sessionBunks = useMemo(() => {
    if (!allBunks || allBunks.length === 0 || !bunkCmId) return []

    const currentBunk = allBunks.find((b) => b.cm_id === bunkCmId)
    // Guard: if allBunks hasn't caught up yet (transient race during fast
    // navigation), return an empty list rather than falling back to getBunkType('')
    // which would classify this as type 'B' and show an unrelated bunk list.
    if (!currentBunk) return []
    const currentBunkType = getBunkType(currentBunk.name ?? '')
    if (currentBunkType === 'AG') return []

    return allBunks
      .filter((bunk) => getBunkType(bunk.name || '') === currentBunkType)
      .sort((a, b) => {
        const keyA = extractSortKey(a.name || '')
        const keyB = extractSortKey(b.name || '')
        if (keyA.primary !== keyB.primary) return keyA.primary - keyB.primary
        return keyA.secondary.localeCompare(keyB.secondary)
      })
      .map((bunk) => ({
        cm_id: bunk.cm_id,
        name: bunk.name || '',
        gender: currentBunkType === 'G' ? 'F' : 'M',
      }))
  }, [allBunks, bunkCmId])

  // Cache the last known good index so a transient miss (allBunks refetch
  // racing a fast navigation) doesn't silently reset the cursor to bunk 0.
  // The ref is updated in a useEffect (not inside useMemo) to keep the memo
  // pure — Strict Mode and React Compiler both surface mid-memo mutations.
  const lastIndexRef = useRef(0)
  const computedIdx = useMemo(
    () => sessionBunks.findIndex((b) => b.cm_id === bunkCmId),
    [sessionBunks, bunkCmId]
  )
  useEffect(() => {
    if (computedIdx !== -1) lastIndexRef.current = computedIdx
  }, [computedIdx])
  const currentBunkIndex = computedIdx === -1 ? lastIndexRef.current : computedIdx

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || !graphData || !isOpen) return

    // Ensure previous instance is cleaned up
    if (cyRef.current && !cyRef.current.destroyed()) {
      cyRef.current.destroy()
      cyRef.current = null
    }

    const cy = cytoscape({
      container: containerRef.current,
      style: getBunkCytoscapeStyles(),
      // Don't set layout in initialization - we'll run it after adding elements
      // wheelSensitivity: 0.3, // Removed to avoid warning
      minZoom: 0.5,
      maxZoom: 3,
    })

    cyRef.current = cy

    // Build Cytoscape element definitions via the shared, unit-tested helper.
    // Sibling edges are filtered at the API response boundary (#1094) and will
    // never appear here. Cross-scope ghost nodes/edges (#1606, #1610) are
    // appended by the helper when the toggle is on and the response carries
    // cross_scope_nodes/edges — extracting this out of the effect keeps the
    // shipped element-building logic covered by tests (Finding 5 follow-up).
    const elements = buildBunkGraphElements(graphData, showCrossScopeEdges)

    cy.add(elements)

    // Run layout after adding elements.
    // Use cola for better layout control. Explicit spacing so disconnected
    // sub-clusters don't pack adjacently and look falsely linked (#1640). The
    // bounding box is derived from the live container so cola spreads nodes to
    // fill the canvas's wide aspect rather than leaving big left/right margins.
    // Cast required: cytoscape's BaseLayoutOptions doesn't include cola's
    // plugin-specific options (nodeSpacing, handleDisconnected, boundingBox).
    const container = containerRef.current
    const layout = cy.layout(
      buildBunkColaLayoutOptions(
        container.clientWidth,
        container.clientHeight
      ) as unknown as Parameters<(typeof cy)['layout']>[0]
    )

    layoutRef.current = layout
    layout.on('layoutstop', () => {
      cy.fit(undefined, 30)
    })
    layout.run()

    // Add click handler for nodes
    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const nodeId = node.data('id') // This is "node-123"
      const camperId = nodeId.replace('node-', '') // Extract just the numeric ID
      setSelectedCamperId(camperId)
    })

    return () => {
      // Stop layout if running
      if (layoutRef.current && typeof layoutRef.current.stop === 'function') {
        layoutRef.current.stop()
      }
      layoutRef.current = null

      if (!cy.destroyed()) {
        // Remove all event listeners first
        cy.removeAllListeners()
        cy.nodes().removeAllListeners()
        cy.edges().removeAllListeners()
        // Then destroy
        cy.destroy()
      }
      cyRef.current = null
    }
  }, [graphData, isOpen, showCrossScopeEdges])

  // Handle resize when details panel opens/closes
  useEffect(() => {
    if (cyRef.current && !cyRef.current.destroyed()) {
      const cy = cyRef.current
      setTimeout(() => {
        if (!cy.destroyed()) {
          cy.resize()
          cy.fit()
        }
      }, 350) // After transition
    }
  }, [selectedCamperId])

  // Export graph as PNG
  const handleExport = () => {
    if (!cyRef.current) return

    const png = cyRef.current.png({
      output: 'blob',
      bg: 'white',
      scale: 2,
      full: true,
    })

    const url = URL.createObjectURL(png)
    const link = document.createElement('a')
    link.href = url
    link.download = `${bunkName.replace(/\s+/g, '_')}_social_network.png`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Navigate to previous bunk (circular)
  const handlePreviousBunk = () => {
    if (sessionBunks.length > 0) {
      // Wrap around to last bunk if at first
      const prevIndex = currentBunkIndex === 0 ? sessionBunks.length - 1 : currentBunkIndex - 1
      const prevBunk = sessionBunks[prevIndex]
      if (prevBunk && onBunkChange) {
        onBunkChange(prevBunk.cm_id, prevBunk.name)
      } else {
        onClose()
      }
    }
  }

  // Navigate to next bunk (circular)
  const handleNextBunk = () => {
    if (sessionBunks.length > 0) {
      // Wrap around to first bunk if at last
      const nextIndex = currentBunkIndex === sessionBunks.length - 1 ? 0 : currentBunkIndex + 1
      const nextBunk = sessionBunks[nextIndex]
      if (nextBunk && onBunkChange) {
        onBunkChange(nextBunk.cm_id, nextBunk.name)
      } else {
        onClose()
      }
    }
  }

  // Zoom controls for mobile
  const handleZoomIn = () => {
    if (!cyRef.current) return
    cyRef.current.zoom(cyRef.current.zoom() * 1.2)
    cyRef.current.center()
  }

  const handleZoomOut = () => {
    if (!cyRef.current) return
    cyRef.current.zoom(cyRef.current.zoom() * 0.8)
    cyRef.current.center()
  }

  const handleFit = () => {
    if (!cyRef.current) return
    cyRef.current.fit()
  }

  // Check if this is an AG bunk or single bunk session
  const isAGBunk = isAGBunkName(bunkName)
  const hideNavigation = isAGBunk || sessionBunks.length === 0

  // Use Activity to preserve state when hidden while unmounting effects
  // The backdrop transitions in/out based on isOpen
  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-start p-0 transition-all duration-300 sm:p-4',
        isOpen ? 'pointer-events-auto bg-black/50' : 'pointer-events-none bg-transparent opacity-0'
      )}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Activity mode={isOpen ? 'visible' : 'hidden'}>
        <div
          className={`bg-card shadow-lodge-xl overflow-hidden rounded-none transition-all duration-300 sm:ml-4 sm:rounded-2xl ${
            selectedCamperId
              ? 'h-full w-full sm:max-h-[95vh] sm:w-[calc(95vw-20rem)] md:w-[calc(95vw-26rem)]'
              : 'h-full w-full sm:max-h-[95vh] sm:w-[95vw]'
          }`}
        >
          {/* Modal Header */}
          <div className="border-border safe-area-top border-b p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:relative sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-foreground flex min-w-0 items-center gap-2 text-lg font-semibold sm:text-xl">
                <Network className="text-primary h-5 w-5 flex-shrink-0" />
                <span className="truncate">{bunkName} Social Network</span>
              </h2>

              {/* Navigation - responsive layout */}
              {!hideNavigation && sessionBunks.length > 1 && (
                <div className="flex items-center gap-1 sm:absolute sm:left-1/2 sm:-translate-x-1/2 sm:transform sm:gap-2">
                  <button
                    onClick={handlePreviousBunk}
                    className="hover:bg-forest-50/50 dark:hover:bg-forest-950/30 text-muted-foreground hover:text-foreground active:bg-forest-100 dark:active:bg-forest-900/40 touch-manipulation rounded-xl p-2 transition-colors sm:p-1.5"
                    title="Previous bunk"
                  >
                    <ChevronLeft className="h-6 w-6 sm:h-5 sm:w-5" />
                  </button>
                  <button
                    onClick={handleNextBunk}
                    className="hover:bg-forest-50/50 dark:hover:bg-forest-950/30 text-muted-foreground hover:text-foreground active:bg-forest-100 dark:active:bg-forest-900/40 touch-manipulation rounded-xl p-2 transition-colors sm:p-1.5"
                    title="Next bunk"
                  >
                    <ChevronRight className="h-6 w-6 sm:h-5 sm:w-5" />
                  </button>
                </div>
              )}

              <div className="ml-auto flex items-center gap-2 sm:ml-0">
                <button
                  onClick={handleExport}
                  className="hover:bg-forest-50/50 dark:hover:bg-forest-950/30 active:bg-forest-100 dark:active:bg-forest-900/40 touch-manipulation rounded-xl p-2.5 transition-colors sm:p-2"
                  title="Download as PNG"
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={onClose}
                  className="hover:bg-forest-50/50 dark:hover:bg-forest-950/30 active:bg-forest-100 dark:active:bg-forest-900/40 touch-manipulation rounded-xl p-2.5 transition-colors sm:p-2"
                  title="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Modal Content */}
          <div className="h-[calc(100%-4rem)] overflow-y-auto p-3 sm:h-auto sm:p-4">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center sm:h-96">
                <div className="px-4 text-center text-gray-500">Loading bunk social network...</div>
              </div>
            ) : graphData ? (
              graphData.nodes.length === 0 ? (
                <div className="flex h-64 items-center justify-center sm:h-96">
                  <div className="px-4 text-center text-gray-500">
                    <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                    <h3 className="mb-2 text-lg font-medium">No Campers Found</h3>
                    <p className="text-sm">
                      {isAGBunkName(bunkName)
                        ? 'This AG bunk does not have any assigned campers yet.'
                        : 'This bunk does not have any assigned campers for this session.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Compact stat + controls strip — replaces the three large
                      metric cards AND the separate cross-scope checkbox row so
                      the graph reclaims that vertical space (#1636). Stats sit
                      inline on the left; the cross-scope toggle rides on the
                      right. Wraps gracefully on narrow screens. */}
                  <div className="bg-forest-50/40 dark:bg-forest-950/30 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-3 py-2 sm:mb-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:gap-x-4">
                      <span
                        className="flex items-center gap-1.5"
                        title="Total campers in this bunk"
                      >
                        <Users className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                        <span className="text-foreground font-semibold">
                          {graphData.nodes.length}
                        </span>
                        <span className="text-muted-foreground">campers</span>
                      </span>

                      <span
                        className="bg-border hidden h-4 w-px sm:inline-block"
                        aria-hidden="true"
                      />

                      <span
                        className="flex items-center gap-1.5"
                        title="Grade range (count per grade)"
                      >
                        <ActivityIcon className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                        <span className="text-foreground font-medium">
                          {(() => {
                            const grades = graphData.nodes
                              .map((n) => n.grade)
                              .filter((g) => g !== null)
                            if (grades.length === 0) return 'N/A'

                            // Count campers per grade
                            const gradeCounts: Record<number, number> = {}
                            grades.forEach((grade) => {
                              gradeCounts[grade] = (gradeCounts[grade] ?? 0) + 1
                            })

                            const uniqueGrades = Object.keys(gradeCounts)
                              .map(Number)
                              .sort((a, b) => a - b)
                            const minGrade = uniqueGrades[0]
                            if (minGrade === undefined) {
                              return 'Unknown grade'
                            }

                            // Format grade range with counts, e.g. "3rd (4) - 4th (8)"
                            if (uniqueGrades.length === 1) {
                              const count = gradeCounts[minGrade]
                              return `${formatGradeOrdinal(minGrade)} (${count ?? 0})`
                            }
                            return uniqueGrades
                              .map((g) => `${formatGradeOrdinal(g)} (${gradeCounts[g]})`)
                              .join(' - ')
                          })()}
                        </span>
                      </span>

                      <span
                        className="bg-border hidden h-4 w-px sm:inline-block"
                        aria-hidden="true"
                      />

                      <span
                        className="flex items-center gap-1.5"
                        title="Campers with no connections"
                      >
                        <AlertTriangle
                          className={clsx(
                            'h-4 w-4 flex-shrink-0',
                            graphData.metrics.isolated_count === 0
                              ? 'text-forest-600'
                              : 'text-destructive'
                          )}
                        />
                        <span
                          className={clsx(
                            'font-semibold',
                            graphData.metrics.isolated_count === 0
                              ? 'text-forest-600'
                              : 'text-destructive'
                          )}
                        >
                          {graphData.metrics.isolated_count}
                        </span>
                        <span className="text-muted-foreground">no connections</span>
                      </span>
                    </div>

                    {/* Cross-scope edges toggle (#1606, #1610) — moved into the
                        stat strip so it no longer consumes a dedicated row. */}
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showCrossScopeEdges}
                        onChange={(e) => setShowCrossScopeEdges(e.target.checked)}
                        className="rounded"
                        aria-label="Show requests to campers outside this bunk"
                      />
                      <span className="text-muted-foreground whitespace-nowrap">
                        Show other bunks
                      </span>
                    </label>
                  </div>

                  {/* Graph Container */}
                  <div className="bg-parchment-50/50 dark:bg-forest-950/20 border-border relative rounded-xl border">
                    <div ref={containerRef} className="h-[50vh] w-full sm:h-[70vh]" />

                    {/* Zoom/fit controls — visible on every breakpoint so
                        desktop users can fit and zoom without a wheel. The
                        legend toggle stays mobile-only since the legend is
                        always rendered on desktop. */}
                    <div className="absolute top-2 right-2 flex flex-col gap-2">
                      <button
                        onClick={handleZoomIn}
                        className="bg-card/95 shadow-lodge-sm touch-manipulation rounded-xl p-2 backdrop-blur-sm"
                        title="Zoom in"
                      >
                        <ZoomIn className="h-5 w-5" />
                      </button>
                      <button
                        onClick={handleZoomOut}
                        className="bg-card/95 shadow-lodge-sm touch-manipulation rounded-xl p-2 backdrop-blur-sm"
                        title="Zoom out"
                      >
                        <ZoomOut className="h-5 w-5" />
                      </button>
                      <button
                        onClick={handleFit}
                        className="bg-card/95 shadow-lodge-sm touch-manipulation rounded-xl p-2 backdrop-blur-sm"
                        title="Fit to screen"
                      >
                        <Maximize2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setShowLegend(!showLegend)}
                        className="bg-card/95 shadow-lodge-sm touch-manipulation rounded-xl p-2 backdrop-blur-sm sm:hidden"
                        title="Toggle legend"
                      >
                        <Info className="h-5 w-5" />
                      </button>
                    </div>

                    {/* Legend - Collapsible on mobile, fixed on desktop */}
                    <div
                      className={clsx(
                        'bg-card/95 shadow-lodge-sm border-border absolute bottom-2 left-2 rounded-xl border p-2 text-xs backdrop-blur-sm transition-all',
                        'hidden sm:block', // Always show on desktop
                        showLegend && '!block' // Show on mobile when toggled
                      )}
                    >
                      <div className="text-foreground mb-2 font-semibold">Graph Legend</div>

                      {/* Node Status — binary: any connection → green, none → red */}
                      <div className="mb-2">
                        <div className="text-muted-foreground mb-1 text-[11px] font-medium">
                          Connections
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full border border-gray-600 dark:border-gray-400"
                              style={{ backgroundColor: BUNK_NODE_COLORS.noConnections }}
                            ></div>
                            <span>No connections</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full border border-gray-600 dark:border-gray-400"
                              style={{ backgroundColor: BUNK_NODE_COLORS.hasConnections }}
                            ></div>
                            <span>Has connections</span>
                          </div>
                          {showCrossScopeEdges && (
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full border-2 border-dashed"
                                style={{
                                  backgroundColor: CROSS_SCOPE_NODE_COLOR,
                                  borderColor: CROSS_SCOPE_NODE_COLOR,
                                }}
                              ></div>
                              <span>In another bunk</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Directionality — line style matches the canvas:
                          dashed for one-way, bold solid for mutual (#1309). */}
                      <div className="mb-2">
                        <div className="text-muted-foreground mb-1 text-[11px] font-medium">
                          Direction
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <svg width="20" height="6" className="flex-shrink-0">
                              <line
                                x1="0"
                                y1="3"
                                x2="20"
                                y2="3"
                                stroke={EDGE_COLORS['request']}
                                strokeWidth="2"
                                strokeDasharray="4 2"
                              />
                            </svg>
                            <span>One-way</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <svg width="20" height="8" className="flex-shrink-0">
                              <line
                                x1="0"
                                y1="4"
                                x2="20"
                                y2="4"
                                stroke={EDGE_COLORS['request']}
                                strokeWidth="3"
                              />
                            </svg>
                            <span>Mutual</span>
                          </div>
                        </div>
                      </div>

                      {/* Grade Indicators */}
                      <div>
                        <div className="text-muted-foreground mb-1 text-[11px] font-medium">
                          Grade Level
                        </div>
                        <div className="space-y-0.5">
                          {(() => {
                            // Get grade counts
                            const allGrades = graphData.nodes
                              .map((n) => n.grade)
                              .filter((g) => g !== null)
                            const gradeCounts: Record<number, number> = {}
                            allGrades.forEach((grade) => {
                              gradeCounts[grade] = (gradeCounts[grade] ?? 0) + 1
                            })
                            const uniqueGrades = Object.keys(gradeCounts)
                              .map(Number)
                              .sort((a, b) => a - b)

                            if (uniqueGrades.length === 0) return null

                            // Grade swatches reuse the same light/mid/dark
                            // ramp the cytoscape nodes draw their text from,
                            // so the legend matches the graph regardless of
                            // how many grades the bunk happens to contain.
                            const legendGradeColors = getBunkGradeColors(uniqueGrades)
                            return uniqueGrades.map((grade) => (
                              <div key={grade} className="flex items-center gap-2">
                                <div
                                  className="h-3 w-3 rounded-full"
                                  style={{ backgroundColor: legendGradeColors[grade] }}
                                ></div>
                                <span>
                                  {formatGradeOrdinal(grade)} ({gradeCounts[grade] ?? 0})
                                </span>
                              </div>
                            ))
                          })()}
                          {graphData.nodes.some((n) => n.first_year) && (
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full border-[3px]"
                                style={{ borderColor: FIRST_YEAR_RING_COLOR }}
                              ></div>
                              <span>First year</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )
            ) : (
              <div className="flex h-64 items-center justify-center sm:h-96">
                <div className="px-4 text-center text-gray-500">
                  No social network data available
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Camper Details Panel */}
        {selectedCamperId && (
          <CamperDetailsPanel
            camperId={selectedCamperId}
            onClose={() => setSelectedCamperId(null)}
            {...(bunkCampers != null && { bunkCampers })}
          />
        )}
      </Activity>
    </div>
  )
}
