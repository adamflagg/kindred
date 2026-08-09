/**
 * The pure half of weekend friend groups — colours, auto-naming, and how a
 * household is named inside a group (kindred#1913 half 1).
 *
 * Forked from summer, not shared with it. `LockGroupActionBar.tsx` holds the
 * same three ideas over campers; the backend grains are households and
 * lodging units rather than campers and bunks, so a shared component with a
 * grain-generic prop soup would be worse than two that look the same. The
 * scenario modal is the in-repo precedent for exactly that trade.
 *
 * ## The one place this deliberately diverges from summer's logic
 *
 * Summer names a group from `camper.last_name`. The weekend equivalent reads
 * `party.sort_name`, NOT `party.display_name`. `display_name` is CampMinder's
 * `mailing_title` — a postal salutation, which kindred#2074 removed from the
 * family card because measured against 2026's 382 rostered households it
 * disagreed with the actual attending adult list on 26.7%, in both directions.
 * A friend group naming families from it would reintroduce precisely what that
 * ruling deleted. `sort_name` is the roster service's surname walk (adult 1's
 * `last_name`, then the eldest child's), which is what summer's `last_name`
 * actually is.
 */
import type { RosterPartyRow } from '../../types/lodging'

/**
 * Summer's palette, unchanged: hex, rainbow order, no greys.
 * `LockGroupActionBar.tsx` holds the same nine values, and
 * `LockGroupPanel.tsx` mirrors them — a third copy is the cost of the fork,
 * and is why this one is exported rather than inlined at its two call sites.
 */
export const FRIEND_GROUP_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
] as const

/** Human labels for the swatches, so a colour is reachable without sight. */
export const FRIEND_GROUP_COLOR_NAMES: Record<string, string> = {
  '#ef4444': 'Red',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#14b8a6': 'Teal',
  '#3b82f6': 'Blue',
  '#6366f1': 'Indigo',
  '#a855f7': 'Purple',
  '#ec4899': 'Pink',
}

/**
 * The colour a new group opens on, rotating by how many the weekend already
 * has — summer's `groups.length % GROUP_COLORS.length`. Two groups made back
 * to back look different without anybody choosing.
 */
export function nextFriendGroupColor(existingGroupCount: number): string {
  const index =
    ((existingGroupCount % FRIEND_GROUP_COLORS.length) + FRIEND_GROUP_COLORS.length) %
    FRIEND_GROUP_COLORS.length
  return FRIEND_GROUP_COLORS[index] ?? FRIEND_GROUP_COLORS[0]
}

/**
 * Auto-name from the two shortest surnames, alphabetically.
 * Example: ["Richardson", "Lee", "Chen"] -> "Chen, Lee".
 *
 * Shown as the name input's PLACEHOLDER, never as its value, so a blank field
 * means "use this" and a typed one wins — summer's exact behaviour. It is
 * computed at render rather than stored, because a stored auto-name goes stale
 * the moment membership changes.
 *
 * A household with no surname on file is SKIPPED rather than contributing an
 * empty token: "Chen, " reads as a bug, and the household is still visibly in
 * the group either way.
 */
export function defaultFriendGroupName(parties: RosterPartyRow[]): string {
  const surnames = parties
    .map((party) => (party.sort_name ?? '').trim())
    .filter((surname) => surname.length > 0)

  if (surnames.length === 0) return ''
  if (surnames.length === 1) return surnames[0] ?? ''

  const shortestTwo = surnames.toSorted((a, b) => a.length - b.length).slice(0, 2)
  return shortestTwo.toSorted((a, b) => a.localeCompare(b)).join(', ')
}

/**
 * How a household is named inside a group.
 *
 * Surname first, then the eldest enrolled child, then the CampMinder id. The
 * salutation is NOT in the chain at any rung — see the header. The child rung
 * matters more than it looks: `sort_name` walks adults before children, so a
 * household reaching it has no surname anywhere, and the child's full name is
 * the only honest thing left to show.
 *
 * `RosterParty.children` arrives oldest-first from the roster service.
 */
export function householdLabel(party: RosterPartyRow): string {
  const surname = (party.sort_name ?? '').trim()
  if (surname) return surname

  const eldest = (party.children ?? [])[0]?.display_name?.trim()
  if (eldest) return eldest

  return `Household ${String(party.household_cm_id ?? 0)}`
}

/**
 * Member-chip labels for one group, disambiguated.
 *
 * `householdLabel` alone collapses to a bare surname, and a group's member
 * chips show ONLY that text — unlike the household picker's cards, which
 * carry a children sub-line underneath and so read fine even when two labels
 * collide. Two households sharing a surname in the same group would
 * otherwise render two identical chips with nothing to tell them apart:
 * React keys on `household_cm_id`, not the label, so nothing crashes — it is
 * silently unreadable instead.
 *
 * A household whose label collides with another member's gets the eldest
 * enrolled child appended, the same fallback rung `householdLabel` already
 * uses when there is no surname at all. A household with no child on file
 * falls back to its CampMinder id, which is always unique.
 */
export function friendGroupMemberLabels(parties: RosterPartyRow[]): Map<number, string> {
  const withLabels = parties.map((party) => ({ party, label: householdLabel(party) }))

  const counts = new Map<string, number>()
  for (const { label } of withLabels) {
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const result = new Map<number, string>()
  for (const { party, label } of withLabels) {
    const cmId = party.household_cm_id ?? 0
    if ((counts.get(label) ?? 0) <= 1) {
      result.set(cmId, label)
      continue
    }
    const eldest = (party.children ?? [])[0]?.display_name?.trim()
    // Truthy, not nullish -- a whitespace-only name trims to '', which must
    // fall back to the id exactly as an absent one does. `??` would let ''
    // through and print "Johnson · " for that household.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const disambiguator = eldest ? eldest : String(cmId)
    result.set(cmId, `${label} · ${disambiguator}`)
  }
  return result
}
