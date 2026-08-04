/**
 * The rule is DIRECTION, not magnitude, and the silent cases are the point.
 *
 * Flagging every disagreement fires on 49 of 92 derivable rows, 37 of them
 * structural noise. These assert the four silences that get it down to 27 —
 * under-derived, exact, confirmed, container — because each one deleted is a
 * badge on a row nobody needed to look at, and a wall of badges is read as
 * decoration.
 */
import { describe, expect, it } from 'vitest'

import type { BedInventory } from '../../../types/beds'
import { capacityFlag, type CapacityFlag, type CapacityFlagInput } from './capacityFlag'

/** Defaults are the silent ones, so each test states only what it is about. */
function input(over: Partial<CapacityFlagInput> = {}): CapacityFlagInput {
  return {
    beds: [] as BedInventory,
    sleeps: '',
    isConfirmed: false,
    isContainer: false,
    ...over,
  }
}

const TWO_BUNKS: BedInventory = [{ type: 'twin_bunk', count: 2 }] // derives 4

describe('capacityFlag — silence', () => {
  it('says nothing when there is no bed inventory to derive from', () => {
    // 21 units are null here: 7 tents with a blank sheet cell, and 4 whose
    // cells name rooms rather than beds. Nobody has surveyed them, so an
    // "empty" badge would be a claim the data does not support.
    expect(capacityFlag(input({ beds: [], sleeps: '6' })).kind).toBe('silent')
  })

  it('says nothing when every bed type is one the vocabulary does not know', () => {
    // normaliseBeds drops these silently and suggestedSleeps then returns 0.
    // 0 means UNKNOWN, so this must land in the same silence as no beds at all
    // rather than reporting a conflict against a number that is missing rows.
    const unknown = [{ type: 'waterbed' as never, count: 3 }]
    expect(capacityFlag(input({ beds: unknown, sleeps: '6' })).kind).toBe('silent')
  })

  it('says nothing when staff sleep fewer people than the beds allow', () => {
    // The 37-row case. `sleeps` is seeded from OBSERVED peak occupancy across
    // 2024-25; derived capacity is a furniture count and an upper bound on it.
    // A 15-bed cabin let to one family is observed at 5 and disagrees with
    // nothing.
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '3' })).kind).toBe('silent')
  })

  it('says nothing when staff and the beds already agree', () => {
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '4' })).kind).toBe('silent')
  })

  it('says nothing once staff have confirmed the unit, even in conflict', () => {
    // Matches apply_lodging_inventory.py, which withholds every non-notes
    // change from a confirmed row. Staff standing in the cabin outrank a sum.
    const conflicting = input({ beds: TWO_BUNKS, sleeps: '8', isConfirmed: true })
    expect(capacityFlag(conflicting).kind).toBe('silent')
  })

  it('says nothing for a container, even in conflict', () => {
    // The only container carrying beds holds JUST the shared living-room
    // futon; its four child rooms carry their own. Its derived capacity is not
    // the building's, so comparing it to a whole-house `sleeps` compares two
    // different buildings. Excluding containers is also what takes the
    // conflict count from 13 to the agreed 12.
    const container = input({ beds: [{ type: 'futon', count: 1 }], sleeps: '7', isContainer: true })
    expect(capacityFlag(container).kind).toBe('silent')
  })
})

describe('capacityFlag — suggestion', () => {
  it('offers the derived number when no staff number exists yet', () => {
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '' }))).toEqual({
      kind: 'suggestion',
      derived: 4,
    })
  })

  it('reads a stored 0 as unknown rather than as "sleeps nobody"', () => {
    // PocketBase cannot store NULL in a number column, so 0 IS the spelling of
    // UNKNOWN. Treating it as a real occupancy would make every unset unit a
    // conflict — the loudest possible reading of the quietest possible fact.
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '0' })).kind).toBe('suggestion')
  })
})

describe('capacityFlag — conflict', () => {
  it('flags staff claiming more people than the beds account for', () => {
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '8' }))).toEqual({
      kind: 'conflict',
      derived: 4,
      sleeps: 8,
    })
  })

  it('flags a one-over the same as any other conflict', () => {
    // Half the real conflicts are exactly +1, and a +1 usually just means a
    // family doubled up — the sum counts a queen as 2 and cannot count two
    // children in one twin. That is a reason to word the copy as a question,
    // NOT a reason for a "+1 is fine" rule that hides six of the twelve.
    expect(capacityFlag(input({ beds: TWO_BUNKS, sleeps: '5' }))).toEqual({
      kind: 'conflict',
      derived: 4,
      sleeps: 5,
    })
  })
})

describe('capacityFlag — the real registry rows', () => {
  // Every row below is a decision the rule was negotiated against, so a change
  // that silently reclassifies one fails here rather than in a staff meeting.
  // The expected flag is asserted whole: a `kind`-only assertion would pass
  // against any implementation that happens to return the right label.
  const ROWS: Array<[string, Partial<CapacityFlagInput>, CapacityFlag]> = [
    // The single most suspicious row in the set — staff say exactly double.
    [
      'hc-upstairs-3',
      { beds: [{ type: 'twin_bunk', count: 2 }], sleeps: '8' },
      { kind: 'conflict', derived: 4, sleeps: 8 },
    ],
    // One of the six +1s: a family doubling up, not a data error.
    [
      'gt-tenaya-2',
      { beds: [{ type: 'twin_bunk', count: 2 }], sleeps: '5' },
      { kind: 'conflict', derived: 4, sleeps: 5 },
    ],
    // Sheet capacity is 4 here and backs STAFF, not the beds — so the bed list
    // is probably short a bed. Still a conflict: the rule reads beds vs sleeps
    // and max_beds is never an input to it.
    [
      'tuolumne-4',
      { beds: [{ type: 'twin', count: 3 }], sleeps: '4' },
      { kind: 'conflict', derived: 3, sleeps: 4 },
    ],
    // The lone container with beds — the shared futon, not the building.
    [
      'gt-clouds-rest',
      { beds: [{ type: 'futon', count: 1 }], sleeps: '7', isContainer: true },
      { kind: 'silent' },
    ],
  ]

  for (const [code, over, expected] of ROWS) {
    it(`classifies ${code} as ${expected.kind}`, () => {
      expect(capacityFlag(input(over))).toEqual(expected)
    })
  }
})
