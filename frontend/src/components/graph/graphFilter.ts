import { UNIT_NAMES, getUnitForBunk } from '../../utils/unitMapping'
import type { GraphNode } from '../../types/graph'
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape'

export type FilterEdgeMode = 'strict' | 'cross-scope'

export interface FilterState {
  units: string[]
  bunks: number[]
  edgeMode: FilterEdgeMode
}

export interface BunkSummary {
  cmId: number
  name: string
}

export function unitToSlug(unit: string): string {
  return unit.toLowerCase().replace(/\s+/g, '-')
}

const SLUG_TO_UNIT: Record<string, string> = Object.fromEntries(
  UNIT_NAMES.map((u) => [unitToSlug(u), u])
)

export function parseFilterFromSearchParams(params: URLSearchParams): FilterState {
  const unitsRaw = params.get('units') ?? ''
  const bunksRaw = params.get('bunks') ?? ''
  const edgesRaw = params.get('edges') ?? ''

  const units = unitsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((slug) => SLUG_TO_UNIT[slug])
    .filter((u): u is string => Boolean(u))

  const bunks = bunksRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)

  const edgeMode: FilterEdgeMode = edgesRaw === 'cross' ? 'cross-scope' : 'strict'

  return { units, bunks, edgeMode }
}

/**
 * Build a new URLSearchParams from `base` with the filter encoded into the
 * `units`, `bunks`, and `edges` keys. Empty filter omits all three keys
 * entirely so the URL stays clean. Unrelated keys in `base` are preserved.
 */
export function serializeFilterToSearchParams(
  filter: FilterState,
  base: URLSearchParams
): URLSearchParams {
  const next = new URLSearchParams(base)
  next.delete('units')
  next.delete('bunks')
  next.delete('edges')

  if (filter.units.length > 0) {
    next.set('units', filter.units.map(unitToSlug).join(','))
  }
  if (filter.bunks.length > 0) {
    next.set('bunks', filter.bunks.join(','))
  }
  if (filter.edgeMode === 'cross-scope') {
    next.set('edges', 'cross')
  }
  return next
}

/**
 * Drop any bunk whose unit is already in the included units list.
 * Unknown bunks (no matching unit, or not present in `allBunks`) are kept
 * — the caller decides whether unknown bunks should ever land in state.
 */
export function normalizeFilter(
  input: { units: string[]; bunks: number[] },
  allBunks: BunkSummary[]
): { units: string[]; bunks: number[] } {
  const includedUnits = new Set(input.units)
  if (includedUnits.size === 0) {
    return { units: [...input.units], bunks: [...input.bunks] }
  }
  const bunkById = new Map(allBunks.map((b) => [b.cmId, b]))
  const bunks = input.bunks.filter((cmId) => {
    const bunk = bunkById.get(cmId)
    if (!bunk) return true // unknown bunk: keep
    const unit = getUnitForBunk(bunk.name)
    if (unit && includedUnits.has(unit)) return false // absorbed
    return true
  })
  return { units: [...input.units], bunks }
}

/**
 * Build a `bunk_cm_id → unit name` map from a bunk roster. Bunks whose
 * names don't map to a unit (via `getUnitForBunk`) are omitted from the
 * map — the caller treats them as "no unit."
 */
export function buildBunkUnitMap(bunks: BunkSummary[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const bunk of bunks) {
    const unit = getUnitForBunk(bunk.name)
    if (unit) map.set(bunk.cmId, unit)
  }
  return map
}

/**
 * Pure-function in-scope test. Empty filter (no units, no bunks) → always
 * true. Otherwise: the node is in scope iff its bunk's unit is included
 * OR its bunk_cm_id is included. Nodes without a bunk_cm_id are out of
 * scope whenever the filter is active.
 */
export function isNodeInScope(
  node: GraphNode,
  filter: FilterState,
  bunkUnitMap: Map<number, string>
): boolean {
  const isActive = filter.units.length > 0 || filter.bunks.length > 0
  if (!isActive) return true
  if (node.bunk_cm_id == null) return false
  if (filter.bunks.includes(node.bunk_cm_id)) return true
  const unit = bunkUnitMap.get(node.bunk_cm_id)
  if (unit && filter.units.includes(unit)) return true
  return false
}

export interface ApplyFilterOptions {
  filter: FilterState
  /** cm_id of the camper currently selected in the detail panel; this node
   *  is kept visible even if it falls out of scope. Pass null when none. */
  selectedNodeId: number | null
  bunkUnitMap: Map<number, string>
  /** When true, the caller has decided animations are off — applyFilterToGraph
   *  doesn't read this directly today (transition is in the CSS class) but
   *  callers may use it elsewhere in the orchestration. */
  prefersReducedMotion: boolean
}

export interface ApplyFilterResult {
  inScopeNodeIds: Set<string>
}

const SCOPE_CLASSES = ['scope-hidden', 'scope-ghost']

/**
 * Apply scope classes to nodes and edges based on `filter`. Pure mutator;
 * does NOT trigger a cytoscape layout. The caller sequences fade → relayout
 * → fit after this call. Idempotent: stale scope classes are cleared first.
 *
 * Rules:
 *   - Empty filter → clear all scope classes, return all node ids.
 *   - Active filter, strict edges:
 *       in-scope nodes:        no scope class
 *       out-of-scope nodes:    scope-hidden (except selectedNodeId)
 *       both-endpoints in:     no scope class
 *       any endpoint out:      scope-hidden
 *   - Active filter, cross-scope edges:
 *       same node rules, except an out-of-scope node that has at least one
 *       in-scope neighbor along a kept edge gets scope-ghost (not -hidden).
 *       Edges with both endpoints out: scope-hidden.
 *   - selectedNodeId is always kept visible (no scope class) regardless of
 *     filter. This is the "selection survival" behavior.
 */
export function applyFilterToGraph(cy: Core, options: ApplyFilterOptions): ApplyFilterResult {
  const { filter, selectedNodeId, bunkUnitMap } = options
  const isActive = filter.units.length > 0 || filter.bunks.length > 0
  const inScopeNodeIds = new Set<string>()

  cy.batch(() => {
    if (!isActive) {
      cy.nodes().forEach((n: NodeSingular) => {
        for (const c of SCOPE_CLASSES) n.removeClass(c)
        inScopeNodeIds.add(n.id())
      })
      cy.edges().forEach((e: EdgeSingular) => {
        for (const c of SCOPE_CLASSES) e.removeClass(c)
      })
      return
    }

    // First pass: classify nodes.
    cy.nodes().forEach((n: NodeSingular) => {
      const idNum = Number(n.id())
      const bunkCmId = n.data('bunk_cm_id') as number | null | undefined
      const inScope = _nodeMatchesFilter(bunkCmId, filter, bunkUnitMap)
      const isSelected = selectedNodeId != null && idNum === selectedNodeId
      for (const c of SCOPE_CLASSES) n.removeClass(c)
      if (inScope || isSelected) {
        inScopeNodeIds.add(n.id())
      } else {
        // Will be ghosted in cross-scope mode if it has a kept edge to an
        // in-scope partner — that decision is made in the edge pass below.
        n.addClass('scope-hidden')
      }
    })

    // Second pass: classify edges and (in cross-scope mode) promote
    // hidden out-of-scope nodes to ghosts when they're a kept-edge partner.
    cy.edges().forEach((e: EdgeSingular) => {
      for (const c of SCOPE_CLASSES) e.removeClass(c)
      const src = e.source()
      const tgt = e.target()
      const sIn = inScopeNodeIds.has(src.id())
      const tIn = inScopeNodeIds.has(tgt.id())
      if (sIn && tIn) return // both in: edge stays
      if (filter.edgeMode === 'strict') {
        e.addClass('scope-hidden')
        return
      }
      // cross-scope: keep edge if at least one endpoint is in-scope.
      if (sIn || tIn) {
        const ghost = sIn ? tgt : src
        ghost.removeClass('scope-hidden')
        ghost.addClass('scope-ghost')
        return
      }
      // both endpoints out-of-scope: hide.
      e.addClass('scope-hidden')
    })
  })

  return { inScopeNodeIds }
}

function _nodeMatchesFilter(
  bunkCmId: number | null | undefined,
  filter: FilterState,
  bunkUnitMap: Map<number, string>
): boolean {
  if (bunkCmId == null) return false
  if (filter.bunks.includes(bunkCmId)) return true
  const unit = bunkUnitMap.get(bunkCmId)
  if (unit && filter.units.includes(unit)) return true
  return false
}
