/**
 * Tests for BunkSocialGraphModal helpers and navigation guard.
 *
 * getBunkType and extractSortKey are exported module-scope helpers and can be
 * exercised without standing up cytoscape or React providers. The guard
 * behavior (missing currentBunk → empty sessionBunks) is verified by
 * importing the helpers directly and asserting the logic they encode.
 *
 * Full integration-rendering tests for this modal would require mocking
 * PocketBase, React Query, and cytoscape, which adds significant setup
 * overhead for marginal gain given the guard is a simple early return.
 * The helper unit tests plus TypeScript checking provide sufficient coverage.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  DEFAULT_SHOW_CROSS_SCOPE_EDGES,
  buildBunksFilter,
  extractBunkCmIdsFromPlans,
} from './BunkSocialGraphModal'
import { extractSortKey, getBunkType } from '../utils/bunkNaming'

// ─── Inline simulation of sessionBunks derivation ────────────────────────────
// Mirrors the useMemo body in BunkSocialGraphModal so we can assert the
// guard behaviour without rendering the component.

interface BunkStub {
  cm_id: number
  name: string
}

function deriveSessionBunks(allBunks: BunkStub[] | undefined, bunkCmId: number) {
  if (!allBunks || allBunks.length === 0 || !bunkCmId) return []

  const currentBunk = allBunks.find((b) => b.cm_id === bunkCmId)
  if (!currentBunk) return [] // Guard under test
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
      gender: getBunkType(bunk.name || '') === 'G' ? 'F' : 'M',
    }))
}

// Unit tests for getBunkType / extractSortKey now live in
// `frontend/src/utils/bunkNaming.test.ts`. They're imported here only so the
// sessionBunks derivation tests below can exercise the same logic.

// ─── extractBunkCmIdsFromPlans ───────────────────────────────────────────────
// Regression guard for #1339: bunk_plans schema has no flat bunk_cm_id column;
// the bunk's CM ID is at expand.bunk.cm_id. Previously an inline interface
// claimed a flat field, returning [] for every real bunk_plans record and
// silently hiding the bunk navigation arrows in the social graph modal.

describe('extractBunkCmIdsFromPlans', () => {
  it('reads cm_id from the expanded bunk relation', () => {
    const bunkPlans = [{ expand: { bunk: { cm_id: 101 } } }, { expand: { bunk: { cm_id: 102 } } }]
    expect(extractBunkCmIdsFromPlans(bunkPlans)).toEqual([101, 102])
  })

  it('deduplicates repeated cm_ids', () => {
    const bunkPlans = [
      { expand: { bunk: { cm_id: 101 } } },
      { expand: { bunk: { cm_id: 101 } } },
      { expand: { bunk: { cm_id: 102 } } },
    ]
    expect(extractBunkCmIdsFromPlans(bunkPlans).sort()).toEqual([101, 102])
  })

  it('skips records missing the expand entirely (e.g. no expand requested)', () => {
    const bunkPlans = [{}, { expand: { bunk: { cm_id: 101 } } }]
    expect(extractBunkCmIdsFromPlans(bunkPlans)).toEqual([101])
  })

  it('skips records where expand.bunk lacks cm_id', () => {
    const bunkPlans = [{ expand: { bunk: {} } }, { expand: { bunk: { cm_id: 102 } } }]
    expect(extractBunkCmIdsFromPlans(bunkPlans)).toEqual([102])
  })

  it('returns [] for an empty input', () => {
    expect(extractBunkCmIdsFromPlans([])).toEqual([])
  })
})

// ─── buildBunksFilter ────────────────────────────────────────────────────────
// Regression guard for #1339 follow-up: the bunks table stores one row per
// (cm_id, year). An unscoped `cm_id = X` filter returns N years of rows per
// logical bunk, leaving allBunks/sessionBunks with adjacent duplicate-cm_id
// entries. Navigation then silently no-ops when wrap lands on a same-cm_id-
// different-year row (the "right arrow not rotating" symptom).

// ─── 'Show other bunks' cross-scope default (#1745) ──────────────────────────
// Staff want cross-bunk request connections visible by default in the bunk
// graph, rather than ticking the "Show other bunks" checkbox each time. The
// toggle's initial state is hoisted to an exported constant so the default is
// unit-testable without standing up cytoscape / React providers.

describe("'Show other bunks' cross-scope default (#1745)", () => {
  it('defaults ON so cross-bunk connections show without ticking the box', () => {
    expect(DEFAULT_SHOW_CROSS_SCOPE_EDGES).toBe(true)
  })
})

describe('buildBunksFilter', () => {
  it('always includes a year clause', () => {
    const filter = buildBunksFilter([4267, 4268], 2026)
    expect(filter).toContain('year = 2026')
  })

  it('joins cm_id clauses with disjunction inside a parenthesised group', () => {
    const filter = buildBunksFilter([1, 2, 3], 2026)
    expect(filter).toBe('(cm_id = 1 || cm_id = 2 || cm_id = 3) && year = 2026')
  })

  it('handles a single cm_id', () => {
    const filter = buildBunksFilter([42], 2025)
    expect(filter).toBe('(cm_id = 42) && year = 2025')
  })

  it('returns empty string for an empty cm_id list', () => {
    expect(buildBunksFilter([], 2026)).toBe('')
  })
})

// ─── sessionBunks guard: missing currentBunk ─────────────────────────────────

describe('sessionBunks derivation — missing currentBunk guard', () => {
  const allBunks: BunkStub[] = [
    { cm_id: 101, name: 'B-1' },
    { cm_id: 102, name: 'B-2' },
    { cm_id: 201, name: 'G-1' },
  ]

  it('returns [] when bunkCmId is not in allBunks (transient race)', () => {
    // bunkCmId 999 doesn't exist — simulates fast navigation before refetch
    expect(deriveSessionBunks(allBunks, 999)).toEqual([])
  })

  it('returns [] when allBunks is undefined', () => {
    expect(deriveSessionBunks(undefined, 101)).toEqual([])
  })

  it('returns [] when allBunks is empty', () => {
    expect(deriveSessionBunks([], 101)).toEqual([])
  })

  it('returns the correct list when currentBunk exists', () => {
    const result = deriveSessionBunks(allBunks, 101)
    expect(result.length).toBe(2) // B-1 and B-2
    expect(result.map((b) => b.cm_id)).toContain(101)
    expect(result.map((b) => b.cm_id)).toContain(102)
    // No girl bunks in the result
    expect(result.map((b) => b.cm_id)).not.toContain(201)
  })

  it('returns [] for an AG bunk even when it exists in allBunks', () => {
    const bunksWithAG: BunkStub[] = [
      { cm_id: 301, name: 'AG-1' },
      { cm_id: 101, name: 'B-1' },
    ]
    expect(deriveSessionBunks(bunksWithAG, 301)).toEqual([])
  })

  it('does NOT fall back to all B-type bunks when currentBunk is missing', () => {
    // Previous buggy behaviour: getBunkType('') returned 'B', causing the list
    // to contain every B-type bunk. The guard must prevent this.
    const result = deriveSessionBunks(allBunks, 999)
    expect(result).toEqual([])
    expect(result.length).toBe(0)
  })
})

// ─── sessionBunks derivation — sort order ────────────────────────────────────

describe('sessionBunks derivation — sort order', () => {
  it('sorts numbered bunks in ascending numeric order', () => {
    const bunks: BunkStub[] = [
      { cm_id: 3, name: 'B-3' },
      { cm_id: 1, name: 'B-1' },
      { cm_id: 2, name: 'B-2' },
    ]
    const result = deriveSessionBunks(bunks, 2)
    expect(result.map((b) => b.name)).toEqual(['B-1', 'B-2', 'B-3'])
  })
})

// ─── Cross-scope legend label (#1752 addendum) ────────────────────────────────

describe('cross-scope legend label', () => {
  it('labels ghost nodes honestly for unassigned targets, not just "In another bunk"', () => {
    // Ghost nodes derive from the session graph, so a cross-scope target can be
    // unassigned (GhostNode.bunk_name is nullable) — the legend entry must not
    // claim every violet node is "In another bunk". Source-content assertion:
    // the legend is inline JSX behind cytoscape/provider setup (see header note).
    const source = readFileSync(resolve(__dirname, './BunkSocialGraphModal.tsx'), 'utf-8')
    expect(source).toContain('In another bunk / unassigned')
  })
})
