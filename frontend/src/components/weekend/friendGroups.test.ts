/**
 * The pure half of weekend friend groups — colours, auto-naming, and how a
 * household is labelled inside a group.
 *
 * Every rule here is summer's, ported to household grain (kindred#1913). The
 * one place it deliberately diverges is the naming SOURCE: summer reads
 * `camper.last_name`, and the weekend equivalent is `party.sort_name`, NOT
 * `party.display_name`. `display_name` is CampMinder's `mailing_title` — a
 * postal salutation that kindred#2074 removed from the family card because it
 * disagreed with the attending adult list on 26.7% of 2026's rostered
 * households. A friend group naming families from it would reintroduce
 * exactly what that ruling deleted.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import {
  defaultFriendGroupName,
  FRIEND_GROUP_COLORS,
  friendGroupMemberLabels,
  householdLabel,
  nextFriendGroupColor,
} from './friendGroups'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    ...overrides,
  }
}

describe('FRIEND_GROUP_COLORS', () => {
  it('is summer’s palette, hex, no greys', () => {
    expect(FRIEND_GROUP_COLORS).toHaveLength(9)
    for (const color of FRIEND_GROUP_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('rotates by the number of groups already on the weekend', () => {
    expect(nextFriendGroupColor(0)).toBe(FRIEND_GROUP_COLORS[0])
    expect(nextFriendGroupColor(3)).toBe(FRIEND_GROUP_COLORS[3])
  })

  it('wraps rather than running off the end', () => {
    expect(nextFriendGroupColor(FRIEND_GROUP_COLORS.length)).toBe(FRIEND_GROUP_COLORS[0])
    expect(nextFriendGroupColor(FRIEND_GROUP_COLORS.length + 2)).toBe(FRIEND_GROUP_COLORS[2])
  })
})

describe('defaultFriendGroupName', () => {
  it('joins the two shortest surnames, alphabetically', () => {
    const name = defaultFriendGroupName([
      party({ sort_name: 'Richardson' }),
      party({ sort_name: 'Lee' }),
      party({ sort_name: 'Chen' }),
    ])
    expect(name).toBe('Chen, Lee')
  })

  it('reads sort_name, never the mailing salutation', () => {
    // If this ever falls back to display_name the name reads "The Johnson
    // Family, The Garcia Family" — the string kindred#2074 deleted.
    const name = defaultFriendGroupName([
      party({ sort_name: 'Johnson', display_name: 'Mr. and Mrs. Johnson' }),
      party({ sort_name: 'Garcia', display_name: 'The Garcia Family' }),
    ])
    expect(name).toBe('Garcia, Johnson')
  })

  it('returns the single surname when only one household is selected', () => {
    expect(defaultFriendGroupName([party({ sort_name: 'Johnson' })])).toBe('Johnson')
  })

  it('is empty when nothing is selected', () => {
    expect(defaultFriendGroupName([])).toBe('')
  })

  it('skips households with no surname on file rather than emitting a gap', () => {
    const name = defaultFriendGroupName([
      party({ sort_name: '' }),
      party({ sort_name: 'Chen' }),
      party({ sort_name: 'Garcia' }),
    ])
    expect(name).toBe('Chen, Garcia')
  })
})

describe('householdLabel', () => {
  it('is the surname when one resolves', () => {
    expect(householdLabel(party({ sort_name: 'Johnson' }))).toBe('Johnson')
  })

  it('falls back to the eldest child rather than to the salutation', () => {
    const label = householdLabel(
      party({
        sort_name: '',
        display_name: 'Mr. and Mrs. Johnson',
        children: [{ person_cm_id: 3000001, display_name: 'Emma Johnson' }],
      })
    )
    expect(label).toBe('Emma Johnson')
  })

  it('names the household by its CampMinder id when nothing else resolves', () => {
    expect(householdLabel(party({ sort_name: '', display_name: '', children: [] }))).toBe(
      'Household 2000001'
    )
  })
})

describe('friendGroupMemberLabels', () => {
  // The member CHIPS render only this label and nothing else -- unlike the
  // household picker's cards, which carry a children sub-line underneath.
  // Two households sharing a surname must not render two identical chips.

  it('leaves a label alone when nothing else in the group collides with it', () => {
    const labels = friendGroupMemberLabels([
      party({ household_cm_id: 2000001, sort_name: 'Johnson' }),
      party({ household_cm_id: 2000002, sort_name: 'Garcia' }),
    ])
    expect(labels.get(2000001)).toBe('Johnson')
    expect(labels.get(2000002)).toBe('Garcia')
  })

  it('disambiguates two households that share a surname with the eldest child', () => {
    const labels = friendGroupMemberLabels([
      party({
        household_cm_id: 2000001,
        sort_name: 'Johnson',
        children: [{ person_cm_id: 3000001, display_name: 'Emma Johnson' }],
      }),
      party({
        household_cm_id: 2000002,
        sort_name: 'Johnson',
        children: [{ person_cm_id: 3000002, display_name: 'Noah Johnson' }],
      }),
    ])
    expect(labels.get(2000001)).toBe('Johnson · Emma Johnson')
    expect(labels.get(2000002)).toBe('Johnson · Noah Johnson')
  })

  it('falls back to the CampMinder id when a colliding household has no child on file', () => {
    const labels = friendGroupMemberLabels([
      party({ household_cm_id: 2000001, sort_name: 'Johnson', children: [] }),
      party({ household_cm_id: 2000002, sort_name: 'Johnson', children: [] }),
    ])
    expect(labels.get(2000001)).toBe('Johnson · 2000001')
    expect(labels.get(2000002)).toBe('Johnson · 2000002')
  })

  it('does not disambiguate a household against a different label', () => {
    // Three households, only two of which collide -- the third keeps its
    // bare label.
    const labels = friendGroupMemberLabels([
      party({
        household_cm_id: 2000001,
        sort_name: 'Johnson',
        children: [{ person_cm_id: 3000001, display_name: 'Emma Johnson' }],
      }),
      party({
        household_cm_id: 2000002,
        sort_name: 'Johnson',
        children: [{ person_cm_id: 3000002, display_name: 'Noah Johnson' }],
      }),
      party({ household_cm_id: 2000003, sort_name: 'Chen' }),
    ])
    expect(labels.get(2000003)).toBe('Chen')
  })
})
