/**
 * Housing needs as alert rows.
 *
 * Rendered in the same grammar as `CamperAlertSection` on the summer side —
 * icon, label, severity-tinted row — so a need reads the same wherever staff
 * meet one. Severity ordering is fixed: red before amber before neutral.
 *
 * Presentational, with no data access of its own. It used to also carry the
 * medical narrative behind a permission-checked reveal; kindred#1889 moved
 * that to `MedicalNarrative`, which only `FamilyDetailsPanel` renders. This
 * component appears once per roster row, 62 to a page, so keeping it free of
 * the medical hook is what stops a later change from making 62 gated
 * requests.
 *
 * ## It no longer keeps its own list of needs
 *
 * This file used to hold a four-branch `if` chain and a four-entry filter
 * array — a SECOND needs table beside `NEED_GLYPHS`, which kindred#2072 had
 * already made "the one place a need is graded". The two disagreed, silently
 * and in the direction that costs the most: `needs_fridge` (kindred#2224) and
 * `needs_step_free` (kindred#2438) drew a per-family glyph on the board and
 * appeared on NO roster surface at all. Six 2026 households ask for a fridge,
 * and one of them sits on a card whose `fridge_coverage` is `none` — a red
 * glyph on the board, while the details panel's "Housing needs" section did
 * not mention a fridge.
 *
 * So the graded needs, their words and their icons all come from `NEED_GLYPHS`
 * now, in its order. Adding a fifth entry there surfaces it here — as a row,
 * and as a roster filter chip — with no edit to this file, and
 * `AccessibilityFlagList.test.tsx` mocks in a synthetic fifth need to prove
 * that rather than trusting it.
 */
import { Accessibility, Baby, ShieldAlert, type LucideIcon } from 'lucide-react'

import type { AccessibilityFlags } from '../../types/lodging'
import type { NeedKey } from './needGlyphs'
import { NEED_GLYPHS } from './needGlyphs'

export interface AccessibilityFlagListProps {
  flags: AccessibilityFlags
}

/**
 * The needs this file renders, as a filter vocabulary (kindred#2251).
 *
 * `NeedKey` is spliced in rather than restated, so the union cannot fall
 * behind `NEED_GLYPHS` without a type error. The two literals either side of
 * it are the only needs that are NOT graded against a cabin, and each is a
 * genuinely different kind of thing rather than a fifth glyph waiting to be
 * written:
 *
 *   `accommodation` — names no specific amenity, so no cabin field answers
 *                     it. `accommodation_is_mandatory` only changes a ROW's
 *                     label and tone below; it plays no part in whether the
 *                     need MATCHES, since the filter asks "does this
 *                     household need one" and a staff member can already see
 *                     mandatory-vs-preferred once they open a row.
 *   `infant`        — derived from the household's ages rather than asked
 *                     for, so it informs which cabin suits them without being
 *                     an unfulfilled request.
 */
export type NeedFilterKey = 'accommodation' | NeedKey | 'infant'

export interface NeedFilterOption {
  key: NeedFilterKey
  label: string
  icon: LucideIcon
  matches: (flags: AccessibilityFlags) => boolean
}

/**
 * The graded needs, DERIVED — one entry per `NEED_GLYPHS` spec, in its order.
 *
 * Order is part of the vocabulary on the card (see `NEED_GLYPHS`' own note),
 * and staff meet the same four needs here, so it is inherited rather than
 * re-chosen. The row list and the filter chips both read this, which is what
 * stops the panel and the toolbar from drifting apart the way the panel and
 * the card just did.
 */
const GRADED_NEED_OPTIONS: NeedFilterOption[] = NEED_GLYPHS.map((glyph) => ({
  key: glyph.key,
  label: glyph.label,
  icon: glyph.Icon,
  matches: (flags: AccessibilityFlags) => flags[glyph.flag] === true,
}))

// eslint-disable-next-line react-refresh/only-export-components -- Shared filter vocabulary, not a component
export const NEED_FILTER_OPTIONS: NeedFilterOption[] = [
  {
    key: 'accommodation',
    label: 'Accommodation',
    icon: Accessibility,
    matches: (flags) => flags.needs_accommodation === true,
  },
  ...GRADED_NEED_OPTIONS,
  {
    key: 'infant',
    label: 'Infant in party',
    icon: Baby,
    matches: (flags) => flags.has_infant === true,
  },
]

type Tone = 'red' | 'amber' | 'neutral'

const TONE_ROW: Record<Tone, string> = {
  red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
  amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
  neutral: 'bg-muted/50 dark:bg-muted/30 text-foreground',
}

const TONE_ICON: Record<Tone, string> = {
  red: 'text-red-500 dark:text-red-400',
  amber: 'text-amber-500 dark:text-amber-400',
  neutral: 'text-muted-foreground',
}

function NeedRow({ label, icon: Icon, tone }: { label: string; icon: LucideIcon; tone: Tone }) {
  return (
    <li className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${TONE_ROW[tone]}`}>
      <Icon className={`h-4 w-4 flex-shrink-0 ${TONE_ICON[tone]}`} aria-hidden="true" />
      <span>{label}</span>
    </li>
  )
}

export function AccessibilityFlagList({ flags }: AccessibilityFlagListProps) {
  const mandatory = flags.accommodation_is_mandatory === true

  const needs: Array<{ key: string; label: string; icon: LucideIcon; tone: Tone }> = []
  if (flags.needs_accommodation === true) {
    needs.push({
      key: 'accommodation',
      label: mandatory ? 'Accommodation required' : 'Accommodation requested',
      icon: mandatory ? ShieldAlert : Accessibility,
      tone: mandatory ? 'red' : 'neutral',
    })
  }
  // Every graded need the household ASKED for, ungraded here.
  //
  // This row says what was requested; it deliberately does not say whether the
  // cabin answers it. That verdict is the glyph's job on the card and
  // `rosterAttention`'s on the roster row, and stating it in a third place is
  // how the three tables kindred#2072 collapsed came to disagree.
  //
  // They are INDEPENDENT needs, all of them. The CPAP and adult-infant source
  // fields are multi-option and one option carries both power and bathroom, so
  // neither implies the other; fridge and step-free are parsed out of the
  // accommodation narrative separately again.
  for (const option of GRADED_NEED_OPTIONS) {
    if (option.matches(flags)) {
      needs.push({ key: option.key, label: option.label, icon: option.icon, tone: 'amber' })
    }
  }
  // Housing suitability, not a request: it informs which cabin suits them
  // (crib space, bathroom proximity, who shares a wall) rather than gating it.
  if (flags.has_infant === true) {
    needs.push({ key: 'infant', label: 'Infant in party', icon: Baby, tone: 'neutral' })
  }

  if (needs.length === 0) return null

  return (
    <ul className="space-y-1">
      {needs.map((need) => (
        <NeedRow key={need.key} label={need.label} icon={need.icon} tone={need.tone} />
      ))}
    </ul>
  )
}
