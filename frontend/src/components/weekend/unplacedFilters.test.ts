/**
 * The four groups the unplaced popout filters by — kindred#2480, staff ruling
 * 2026-08-21, visual picks locked 2026-08-24.
 *
 * This file is the specification for `unplacedFilters.ts`. The load-bearing
 * assertion is §"one calculation": the sharing predicate must BE the emphasis
 * predicate, not a copy of it, so the filter and the marks that glow on the
 * board can never disagree about who is open to sharing.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { anchorIsEmphasized, clusterIsEmphasized } from './shareEmphasis'
import { resolveShareAnchor, resolveShareCluster } from './shareMarks'
import { UNPLACED_FILTER_GROUPS, unplacedFilterGroup } from './unplacedFilters'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    display_name: 'Johnson',
    ...overrides,
  }
}

describe('UNPLACED_FILTER_GROUPS — the closed set', () => {
  it('is exactly four groups, in the ruled order', () => {
    // Single-select, one group at a time (owner 2026-08-21) — the ruling
    // exists so a party in 2+ groups never needs a tie-break. Four parties in
    // a median 2026 weekend are in 2+, so this is not hypothetical.
    expect(UNPLACED_FILTER_GROUPS.map((group) => group.key)).toEqual([
      'under_two',
      'bathroom',
      'power',
      'sharing',
    ])
  })

  it('takes the bathroom and power marks from needGlyphs, never a second copy', async () => {
    // The chip must be the same mark the card draws. Importing the spec is
    // what guarantees that; a hand-written icon/hue pair would drift the first
    // time either changes.
    const { needGlyph } = await import('./needGlyphs')
    expect(unplacedFilterGroup('bathroom').Icon).toBe(needGlyph('bathroom').Icon)
    expect(unplacedFilterGroup('bathroom').hueClassName).toBe(needGlyph('bathroom').hueClassName)
    expect(unplacedFilterGroup('power').Icon).toBe(needGlyph('power').Icon)
    expect(unplacedFilterGroup('power').hueClassName).toBe(needGlyph('power').hueClassName)
  })

  it('gives every group an accessible name — the chips are icon-only', () => {
    // Icon + count is the locked style (no text label), so the label is the
    // button's only name. Test-infrastructure per frontend/CLAUDE.md, not a11y.
    for (const group of UNPLACED_FILTER_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0)
    }
  })
})

describe('under_two — the computed flag, never has_infant', () => {
  it('matches on has_child_under_two', () => {
    expect(
      unplacedFilterGroup('under_two').matches(party({ flags: { has_child_under_two: true } }))
    ).toBe(true)
    expect(
      unplacedFilterGroup('under_two').matches(party({ flags: { has_child_under_two: false } }))
    ).toBe(false)
    expect(unplacedFilterGroup('under_two').matches(party())).toBe(false)
  })

  it('never keys on has_infant, which is dead on family weekends', () => {
    // 0 of 3,923 production family_camp_registrations rows — its source field
    // is answered only on adult sessions. A filter keyed there matches nobody.
    expect(unplacedFilterGroup('under_two').matches(party({ flags: { has_infant: true } }))).toBe(
      false
    )
  })
})

describe('bathroom and power — the party-side flags', () => {
  it('match their own flag and nothing else', () => {
    expect(
      unplacedFilterGroup('bathroom').matches(party({ flags: { needs_private_bathroom: true } }))
    ).toBe(true)
    expect(unplacedFilterGroup('bathroom').matches(party({ flags: { needs_power: true } }))).toBe(
      false
    )
    expect(unplacedFilterGroup('power').matches(party({ flags: { needs_power: true } }))).toBe(true)
    expect(
      unplacedFilterGroup('power').matches(party({ flags: { needs_private_bathroom: true } }))
    ).toBe(false)
  })
})

describe('sharing — ONE calculation, shared with the emphasis treatment', () => {
  /*
   * `shareEmphasis.ts`'s own docstring says this issue "should import them
   * rather than restate them". These tests pin that it did: for every shape
   * that matters, the filter's answer and the emphasis answer agree.
   */
  const emphasized = (p: RosterPartyRow) =>
    anchorIsEmphasized(resolveShareAnchor(p)) || clusterIsEmphasized(resolveShareCluster(p))

  const cases: ReadonlyArray<readonly [string, RosterPartyRow, boolean]> = [
    ['a yes anchor', party({ share: { preference: 'yes_share' } }), true],
    ['WITH-named ticked', party({ share: { wants_with_named: true, proximity: ['with'] } }), true],
    ['similar-age ticked', party({ share: { proximity: ['similar_ages', 'with'] } }), true],
    ['a maybe anchor', party({ share: { preference: 'maybe_mutual' } }), false],
    ['a no anchor', party({ share: { preference: 'no_share' } }), false],
    ['unanswered', party({ share: { preference: 'unknown' } }), false],
    ['NEAR only', party({ share: { preference: 'no_share', proximity: ['near'] } }), false],
    ['no share block at all', party(), false],
  ]

  it.each(cases)('%s — the filter and the emphasis agree', (_name, p, expected) => {
    expect(unplacedFilterGroup('sharing').matches(p)).toBe(expected)
    expect(emphasized(p)).toBe(expected)
  })

  it('excludes maybe_mutual and unknown by ruling, not by accident', () => {
    // "Maybe" means "only with a family I already know" — narrower than open.
    // 97 households in 2026 answer maybe; folding them in would nearly double
    // the group and make it mean something else.
    expect(
      unplacedFilterGroup('sharing').matches(party({ share: { preference: 'maybe_mutual' } }))
    ).toBe(false)
  })

  it('never matches a person-grain party, which has no share block', () => {
    // Adult weekends enrol individuals; absence is not a refusal, but it is
    // also not an opt-in.
    expect(
      unplacedFilterGroup('sharing').matches(party({ grain: 'person', person_cm_id: 1000002 }))
    ).toBe(false)
  })
})
