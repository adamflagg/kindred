/**
 * The four groups the board's Unplaced popout filters by — kindred#2480.
 *
 * Staff ruling 2026-08-21: **single-select, one group at a time.** The ruling
 * is not a simplification, it is the whole design — it means a party in two
 * groups never needs a tie-break rule, and four parties in a median 2026
 * weekend are in two (56 unplaced: 4 under-2, 6 bathroom, 5 power, 13 sharing).
 *
 * Visual picks locked 2026-08-24 (Unplaced Filter Lab): icon + count, no text
 * label, solid-fill active state, zero-count chips DIMMED rather than hidden.
 * The count is the load-bearing part — it answers "is this group worth
 * clicking" before the click, and a hidden chip cannot say "this group is
 * empty". Empty groups are ordinary: 2026's FC3 has zero power parties and
 * FC7 has one bathroom party.
 *
 * ## Why this is not `NEED_FILTER_OPTIONS`
 *
 * The roster tab's filter (`AccessibilityFlagList.ts`) is a SIX-key
 * multi-select over the graded needs plus `accommodation` and the dead
 * `infant`. kindred#2480's body asked this surface to reuse it; the owner's
 * later single-select ruling supersedes that. These four groups are a
 * different question — "which unplaced party do I work next" rather than
 * "who asked for what" — so `accommodation`, `fridge` and `step_free` are out,
 * `sharing` is new, and `under_two` replaces `infant`.
 *
 * What IS shared is the part that can drift into a contradiction: the mark
 * vocabulary (`needGlyphs.ts`) and the share predicate (`shareEmphasis.ts`).
 * Both are imported below, never restated.
 */
import { Baby, HeartHandshake, type LucideIcon } from 'lucide-react'

import type { RosterPartyRow } from '../../types/lodging'
import { needGlyph } from './needGlyphs'
import { anchorIsEmphasized, clusterIsEmphasized } from './shareEmphasis'
import { resolveShareAnchor, resolveShareCluster } from './shareMarks'

export type UnplacedFilterKey = 'under_two' | 'bathroom' | 'power' | 'sharing'

export interface UnplacedFilterGroup {
  readonly key: UnplacedFilterKey
  /** The chip's accessible name and tooltip — the chips are icon-only. */
  readonly label: string
  readonly Icon: LucideIcon
  readonly hueClassName: string
  readonly matches: (party: RosterPartyRow) => boolean
}

/**
 * Open to sharing — the owner's set, resolved through the SAME two predicates
 * the glow treatment uses.
 *
 * `shareEmphasis.ts`'s docstring instructs this issue to import them rather
 * than restate them, and that is not tidiness: a second copy would let the
 * filter and the marks that glow disagree about who is open to sharing, on the
 * same card, in the same popout.
 *
 * The set is the yes anchor, WITH-named, and similar-age. `maybe_mutual` is
 * OUT by ruling — it means "only with a family I already know", which is
 * narrower than open, and folding its 97 households in would nearly double the
 * group into meaning something else. NEAR is proximity, not sharing.
 */
function isOpenToSharing(party: RosterPartyRow): boolean {
  return (
    anchorIsEmphasized(resolveShareAnchor(party)) || clusterIsEmphasized(resolveShareCluster(party))
  )
}

const bathroomGlyph = needGlyph('bathroom')
const powerGlyph = needGlyph('power')

export const UNPLACED_FILTER_GROUPS: readonly UnplacedFilterGroup[] = [
  {
    key: 'under_two',
    label: 'Child under 2',
    Icon: Baby,
    // The Baby mark's own pink (`FamilyCard`), which sits deliberately outside
    // the closed four-hue need set: under-2 is an ungraded fact about the
    // party, not a need matched against a cabin.
    hueClassName: 'text-pink-500 dark:text-pink-400',
    // `has_child_under_two`, computed server-side from birthdates against the
    // session start (24 months). NEVER `has_infant` — that is form-declared
    // from a question only adult sessions answer, and is false on all 3,923
    // production family_camp_registrations rows.
    matches: (party) => party.flags?.has_child_under_two === true,
  },
  {
    key: 'bathroom',
    label: bathroomGlyph.label,
    Icon: bathroomGlyph.Icon,
    hueClassName: bathroomGlyph.hueClassName,
    matches: (party) => party.flags?.[bathroomGlyph.flag] === true,
  },
  {
    key: 'power',
    label: powerGlyph.label,
    Icon: powerGlyph.Icon,
    hueClassName: powerGlyph.hueClassName,
    matches: (party) => party.flags?.[powerGlyph.flag] === true,
  },
  {
    key: 'sharing',
    label: 'Open to sharing',
    // HeartHandshake — the WITH-named mark, owner pick 2026-08-24. The group is
    // three marks wide (yes anchor, WITH-named, similar-age) and no single
    // icon means all three; this one names the commonest member.
    Icon: HeartHandshake,
    hueClassName: 'text-forest-800 dark:text-forest-300',
    matches: isOpenToSharing,
  },
]

/** Lookup by key. Throws on an unknown key rather than returning undefined. */
export function unplacedFilterGroup(key: UnplacedFilterKey): UnplacedFilterGroup {
  const group = UNPLACED_FILTER_GROUPS.find((candidate) => candidate.key === key)
  if (!group) throw new Error(`Unknown unplaced filter group: ${key}`)
  return group
}
