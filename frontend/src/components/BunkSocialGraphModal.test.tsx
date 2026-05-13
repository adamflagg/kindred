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
import {
  buildBunksFilter,
  extractBunkCmIdsFromPlans,
  extractSortKey,
  getBunkType,
} from './BunkSocialGraphModal'

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

// ─── getBunkType ──────────────────────────────────────────────────────────────

describe('getBunkType', () => {
  it('returns B for an empty string', () => {
    expect(getBunkType('')).toBe('B')
  })

  it('classifies boy bunks', () => {
    expect(getBunkType('B-1')).toBe('B')
    expect(getBunkType('B-12')).toBe('B')
  })

  it('classifies girl bunks', () => {
    expect(getBunkType('G-1')).toBe('G')
    expect(getBunkType('G-7')).toBe('G')
  })

  it('classifies AG bunks by prefix', () => {
    expect(getBunkType('AG-1')).toBe('AG')
    expect(getBunkType('AG1')).toBe('AG')
  })

  it('falls back to B for unrecognised names', () => {
    expect(getBunkType('Cabin-5')).toBe('B')
  })

  // #1164: classification was previously a substring match (`name.includes('AG')`),
  // which mis-classified incidental occurrences. The match must be prefix-anchored
  // and bounded — AG followed by end-of-string, whitespace, hyphen, or a digit.
  describe('#1164 — AG match must be prefix-anchored, not substring', () => {
    it.each([
      ['AG', 'AG'],
      ['AG-1', 'AG'],
      ['AG1', 'AG'],
      ['AG Alph', 'AG'],
      ['AG-Alpha-1', 'AG'],
    ])('classifies %s as AG', (name, expected) => {
      expect(getBunkType(name)).toBe(expected)
    })

    it.each([
      ['STAGE', 'B'], // Incidental "AG" mid-word
      ['page', 'B'], // Incidental "ag" lowercased
      ['BAG-1', 'B'], // "AG" inside a B-prefixed name
      ['B-1AG', 'B'], // Trailing AG suffix on a B bunk (was previously mis-AG'd; #1164 inverts)
      ['Stage-1', 'B'], // Mixed-case "ag" mid-word
    ])('does NOT classify %s as AG (incidental match)', (name, expected) => {
      expect(getBunkType(name)).toBe(expected)
    })
  })
})

// ─── extractSortKey ───────────────────────────────────────────────────────────

describe('extractSortKey', () => {
  it('places Alpha bunks at primary -2', () => {
    expect(extractSortKey('Alpha').primary).toBe(-2)
    expect(extractSortKey('B-Alph-1').primary).toBe(-2)
  })

  it('places Beta bunks at primary -1', () => {
    expect(extractSortKey('Beta').primary).toBe(-1)
    expect(extractSortKey('G-Bet-2').primary).toBe(-1)
  })

  it('extracts numeric sort key for numbered bunks', () => {
    expect(extractSortKey('B-3').primary).toBe(3)
    expect(extractSortKey('G-10').primary).toBe(10)
  })

  it('sorts lower numbers before higher numbers', () => {
    const k1 = extractSortKey('B-1')
    const k2 = extractSortKey('B-9')
    expect(k1.primary).toBeLessThan(k2.primary)
  })

  it('falls back to primary 999 for unrecognised patterns', () => {
    expect(extractSortKey('Unknown').primary).toBe(999)
  })
})

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
