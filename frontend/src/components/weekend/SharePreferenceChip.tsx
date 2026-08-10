/**
 * The 3-state cabin-sharing preference (spec §4.3), plus "not answered".
 *
 * The wire values are Go's — this layer names them, it does not invent them:
 *
 *   no_share     "No, prefer not to share"             -> hard no
 *   maybe_mutual "Maybe, if a specific family we know"  -> honour only a MUTUAL match
 *   yes_share    "Yes, ..."                             -> eligible for staff pairing
 *   unknown      never answered                         -> NOT consent
 *
 * The unknown state deliberately does not look like the yes state: a blank
 * answer is missing information, not permission.
 */
import type { SharePreferenceValue } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'

const CHIP: Record<SharePreferenceValue, { label: string; className: string }> = {
  no_share: {
    label: 'Will not share',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  },
  maybe_mutual: {
    label: 'Only if mutual',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  yes_share: {
    label: 'Open to sharing',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  unknown: {
    label: 'Not answered',
    className: 'bg-muted text-muted-foreground',
  },
}

export interface SharePreferenceChipProps {
  preference: SharePreferenceValue
  /**
   * The verbatim CampMinder answer, so staff can audit what the label is a
   * paraphrase of. Reachable by hover, keyboard focus AND tap (kindred#2177);
   * it used to be a `title`, which is only the first of those.
   */
  raw?: string | undefined
}

export function SharePreferenceChip({ preference, raw }: SharePreferenceChipProps) {
  // Guard the lookup rather than trusting the union: if Go grows a fourth
  // preference value before these types are regenerated, an unmapped key
  // would otherwise crash the whole roster on `chip.label`.
  const chip = Object.hasOwn(CHIP, preference) ? CHIP[preference] : CHIP.unknown
  const chipClassName = `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${chip.className}`

  // Only a chip with an answer behind it becomes a control. "Not answered"
  // explains itself, and a focusable chip that reveals nothing is a dead stop
  // in the tab order — the same argument `MapUnitPopover` makes for its empty
  // cells.
  // TRIMMED, unlike `FamilyCard`'s `Chip`, whose detail is built from a code
  // template and cannot be blank: this string comes straight out of a
  // CampMinder cell, and a whitespace-only one would otherwise mint a
  // focusable chip whose bubble renders nothing.
  if (raw === undefined || raw.trim().length === 0) {
    return <span className={chipClassName}>{chip.label}</span>
  }

  return (
    <Tooltip content={raw} className={chipClassName}>
      {chip.label}
    </Tooltip>
  )
}
