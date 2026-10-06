import type { ReactNode } from 'react'

import type { ConfirmationOut } from '../../../types/api-generated'
import { householdChipClass, ID_CHIP, PILL, PILL_WRAP, type PillTone } from './kitStyles'
import { formatShortDate } from './dates'
import { CM_PENDING_WORD } from '../requests/views'
import { formatGap, formatMoney } from './money'

export function StatusPill({
  tone,
  children,
  wrap = false,
}: {
  tone: PillTone
  children: ReactNode
  /** Wrap inside a narrow column rather than be cut off by it. */
  wrap?: boolean
}) {
  return (
    <span
      className={wrap ? `${PILL[tone].replace('whitespace-nowrap', '')} ${PILL_WRAP}` : PILL[tone]}
    >
      {children}
    </span>
  )
}

/**
 * The confirmation state beside every Posted figure (D59; posted-words.html E): pending · ✓ confirmed
 * (date) · CampMinder shows $X · short/over $Y · Missing in CM · reversed (date). CampMinder's own
 * figure appears only when it disagrees. The gap is exact to the cent (D74). "pending" and "Missing in
 * CM" are the grid's own words (owner V1: one vocabulary); pending is the CM ✓ chip's constant.
 */
export function ConfirmationState({ confirmation }: { confirmation: ConfirmationOut }) {
  const on = confirmation.on ? ` ${formatShortDate(confirmation.on)}` : ''
  switch (confirmation.status) {
    case 'awaiting_sync':
      return (
        <StatusPill wrap tone="muted">
          {CM_PENDING_WORD}
        </StatusPill>
      )
    case 'confirmed':
      return (
        <StatusPill wrap tone="emerald">
          ✓ confirmed{on}
        </StatusPill>
      )
    case 'short':
    case 'over':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            CampMinder shows {formatMoney(confirmation.in_campminder)}
          </span>
          <StatusPill wrap tone="amber">
            {formatGap(confirmation.locked, confirmation.in_campminder)}
          </StatusPill>
        </span>
      )
    case 'not_in_campminder':
      return (
        <StatusPill wrap tone="amber">
          Missing in CM
        </StatusPill>
      )
    case 'reversed':
      return (
        <StatusPill wrap tone="stone">
          reversed{on}
        </StatusPill>
      )
  }
}

/** "1 · Johnson" (D32), whenever more than one household is on a page. */
export function HouseholdChip({ index, name }: { index: number; name: string }) {
  return (
    <span className={householdChipClass(index)}>
      {index} · {name}
    </span>
  )
}

/**
 * Beside a negative Remaining (§4.2; D119): "over allocation" on a pool or round, whose split is
 * finance's soft setting, and "over budget" only on the total, the one hard number.
 */
export function OverPill({ scope }: { scope: 'pool' | 'total' }) {
  return (
    <StatusPill tone="amber">{scope === 'total' ? 'over budget' : 'over allocation'}</StatusPill>
  )
}

/** A matched CampMinder id, shown under the name it belongs to (D27; ids cost no column). */
export function IdChip({ id }: { id: number }) {
  return <span className={ID_CHIP}>{id}</span>
}
