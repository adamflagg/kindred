import { useEffect, useMemo, useRef, useState, Activity } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape'
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
import { getSessionShorthand } from '../utils/sessionDisplay'
import {
  BUNK_NODE_COLORS,
  FIRST_YEAR_RING_COLOR,
  FIRST_YEAR_RING_WIDTH,
  getBunkGradeColors,
  getNodeColor,
} from './bunkGraphStyles'
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
  priority?: number
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
  nodes: GraphNode[]
  edges: GraphEdge[]
  metrics: BunkGraphMetrics
  health_score: number
}

// Edge type colors (matching main graph)
const EDGE_COLORS: Record<string, string> = {
  request: '#3498db', // Blue for all request edges
}

// Helpers hoisted to module scope: they reference no closure values and were
// previously redeclared on every useMemo recompute. Exported for unit tests.
// eslint-disable-next-line react-refresh/only-export-components
export const isAGBunkName = (name: string): boolean => /^AG(?:$|[\s-]|\d)/.test(name)

// eslint-disable-next-line react-refresh/only-export-components
export const getBunkType = (name: string): 'G' | 'B' | 'AG' => {
  if (!name) return 'B'
  if (isAGBunkName(name)) return 'AG'
  if (name.startsWith('G-')) return 'G'
  if (name.startsWith('B-')) return 'B'
  return 'B'
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

// eslint-disable-next-line react-refresh/only-export-components
export const extractSortKey = (name: string): { primary: number; secondary: string } => {
  if (name.includes('Alph')) return { primary: -2, secondary: name }
  if (name.includes('Bet')) return { primary: -1, secondary: name }
  const match = name.match(/[GB]-(\d+)/)
  if (match?.[1]) return { primary: parseInt(match[1], 10), secondary: name }
  return { primary: 999, secondary: name }
}

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

  // Fetch bunk graph data. The query key and in-memory graph cache both
  // include scenarioId so scenario-sourced and production graphs never collide.
  const { data: graphData, isLoading } = useQuery<BunkGraphData>({
    queryKey: queryKeys.bunkSocialGraph(bunkCmId, sessionCmId, year, scenarioId),
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
            scenarioId
          )
        },
        year,
        scenarioId
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

      const bunkFilter = bunkCmIds.map((id) => `cm_id = ${id}`).join(' || ')
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
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: NodeSingular) => {
              // const nodeId = parseInt(ele.id().replace('node-', ''));
              const degree = ele.degree(false)
              return getNodeColor(degree)
            },
            width: 40, // Fixed circular nodes
            height: 40,
            label: 'data(label)',
            'font-size': '14px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 8, // More spacing from node
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            color: 'data(gradeColor)', // Keep grade color for text
            'text-outline-width': 2,
            'text-outline-color': '#ffffff',
            'overlay-padding': '6px',
          },
        },
        {
          selector: 'node.isolated',
          style: {
            // Isolated nodes don't need special border styling
          },
        },
        {
          selector: 'node.first-year',
          style: {
            // The amber ring is the entire first-year signal — making it
            // thicker than the default node border keeps the marker centered
            // by geometry (no SVG badge to drift at fractional zooms) while
            // still clearly distinguishing first-year campers.
            'border-width': FIRST_YEAR_RING_WIDTH,
            'border-color': FIRST_YEAR_RING_COLOR,
            'border-style': 'solid',
          },
        },
        {
          selector: 'edge',
          style: {
            // Default is a dashed one-way request arrow. The backend
            // (build_bunk_graph) already collapses mutual pairs into a single
            // edge tagged reciprocal — those pick up the bold solid
            // double-headed style from the edge[?reciprocal] selector below.
            // Mirrors the session-level treatment in
            // graph/cytoscapeStyles.ts (#1309).
            width: 2,
            'line-style': 'dashed',
            'line-color': (ele: EdgeSingular) => {
              const edgeType = ele.data('edge_type')
              return EDGE_COLORS[edgeType] ?? '#95a5a6'
            },
            'target-arrow-shape': (ele: EdgeSingular) => {
              const edgeType = ele.data('edge_type')
              return edgeType === 'request' ? 'triangle' : 'none'
            },
            'target-arrow-color': (ele: EdgeSingular) => {
              const edgeType = ele.data('edge_type')
              return EDGE_COLORS[edgeType] ?? '#95a5a6'
            },
            'line-opacity': (ele: EdgeSingular) => {
              const confidence = ele.data('confidence') ?? 0.5
              // Opacity based on confidence: 0.3 to 0.9
              return Math.max(0.3, Math.min(0.9, confidence))
            },
            'curve-style': 'straight',
            'control-point-step-size': 40,
            'overlay-padding': '3px',
          },
        },
        {
          selector: 'edge[?reciprocal]',
          style: {
            // Bold solid double-headed line for backend-collapsed mutual pairs.
            width: 4,
            'line-style': 'solid',
            'source-arrow-shape': 'triangle',
            'source-arrow-color': (ele: EdgeSingular) => {
              const edgeType = ele.data('edge_type')
              return EDGE_COLORS[edgeType] ?? '#95a5a6'
            },
          },
        },
      ],
      // Don't set layout in initialization - we'll run it after adding elements
      // wheelSensitivity: 0.3, // Removed to avoid warning
      minZoom: 0.5,
      maxZoom: 3,
    })

    cyRef.current = cy

    // Build Cytoscape element definitions. Sibling edges are filtered at the
    // API response boundary (#1094) and will never appear here.
    const elements: cytoscape.ElementDefinition[] = []
    const nodeDegrees: Record<string, number> = {}

    // Calculate node degrees first
    graphData.edges.forEach((edge) => {
      const sourceId = `node-${edge.source}`
      const targetId = `node-${edge.target}`
      nodeDegrees[sourceId] = (nodeDegrees[sourceId] ?? 0) + 1
      nodeDegrees[targetId] = (nodeDegrees[targetId] ?? 0) + 1
    })

    // Light → mid → dark grade ramp (younger to older). Logic lives in
    // bunkGraphStyles so the mapping is unit-tested.
    const grades = [
      ...new Set(graphData.nodes.map((n) => n.grade).filter((g) => g !== null)),
    ] as number[]
    const gradeColors = getBunkGradeColors(grades)

    // Add nodes with vertical randomization
    graphData.nodes.forEach((node, index) => {
      const nodeId = `node-${node.id}`
      const degree = nodeDegrees[nodeId] ?? 0

      // Add significant vertical randomization to reduce text overlap
      const verticalOffset = (Math.random() - 0.5) * 300 // -150 to +150 range

      const nodeClasses = []
      if (degree === 0) nodeClasses.push('isolated')
      if (node.first_year) nodeClasses.push('first-year')

      elements.push({
        group: 'nodes',
        data: {
          ...node,
          id: nodeId, // Override node.id with string version
          // Display full name with grade and historical info. The first-year
          // marker is rendered as a centered badge inside the node (see the
          // 'node.first-year' style) — appending "①" to the label was pushing
          // longer names onto a third line.
          label: `${node.name} (${formatGradeOrdinal(node.grade)})${
            node.last_year_bunk && node.last_year_session
              ? `\n${getSessionShorthand(node.last_year_session)}: ${node.last_year_bunk}`
              : ''
          }`,
          fullName: node.name,
          degree: degree,
          gradeColor: node.grade ? gradeColors[node.grade] : '#666666',
          firstYear: node.first_year ?? false,
        },
        position: { x: index * 100, y: verticalOffset }, // Even horizontal spacing, random vertical
        classes: nodeClasses.join(' '),
      })
    })

    // Backend already collapses mutual same-type pairs into a single edge
    // tagged reciprocal=true; the edge[?reciprocal] cytoscape selector picks
    // those up for the bold solid double-headed render (#1309).
    let edgeIndex = 0
    graphData.edges.forEach((edge) => {
      elements.push({
        group: 'edges',
        data: {
          ...edge,
          id: `edge-${edgeIndex++}`,
          source: `node-${edge.source}`,
          target: `node-${edge.target}`,
          edge_type: edge.edge_type,
        },
      })
    })

    cy.add(elements)

    // Run layout after adding elements
    // Use cola for better layout control
    const layout = cy.layout({
      name: 'cola',
    })

    layoutRef.current = layout
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
  }, [graphData, isOpen])

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
                  {/* Metrics Bar */}
                  <div className="mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:gap-4">
                    <div className="bg-forest-50/40 dark:bg-forest-950/30 rounded-xl p-2 sm:p-3">
                      <div className="text-muted-foreground flex items-center gap-1 text-xs sm:gap-2 sm:text-sm">
                        <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Total Campers</span>
                        <span className="sm:hidden">Total</span>
                      </div>
                      <div className="text-foreground text-lg font-semibold sm:text-2xl">
                        {graphData.nodes.length}
                      </div>
                    </div>

                    <div className="bg-forest-50/40 dark:bg-forest-950/30 rounded-xl p-2 sm:p-3">
                      <div className="text-muted-foreground flex items-center gap-1 text-xs sm:gap-2 sm:text-sm">
                        <ActivityIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Grade Range</span>
                        <span className="sm:hidden">Grades</span>
                      </div>
                      <div className="text-sm font-semibold sm:text-lg">
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

                          // Format grade range with counts
                          if (uniqueGrades.length === 1) {
                            const count = gradeCounts[minGrade]
                            return `${formatGradeOrdinal(minGrade)} (${count ?? 0})`
                          } else {
                            // Format as "3rd (4) - 4th (8)" instead of "3rd - 4th (4, 8)"
                            const formattedGrades = uniqueGrades
                              .map((g) => `${formatGradeOrdinal(g)} (${gradeCounts[g]})`)
                              .join(' - ')
                            return formattedGrades
                          }
                        })()}
                      </div>
                    </div>

                    <div className="bg-forest-50/40 dark:bg-forest-950/30 rounded-xl p-3">
                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        No Connections
                      </div>
                      <div
                        className={clsx(
                          'text-2xl font-semibold',
                          graphData.metrics.isolated_count === 0
                            ? 'text-forest-600'
                            : 'text-destructive'
                        )}
                      >
                        {graphData.metrics.isolated_count}
                      </div>
                    </div>
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
