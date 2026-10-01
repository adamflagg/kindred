import type { ReactNode } from 'react'

import type { ConfirmationOut } from '../../../types/api-generated'
import { householdChipClass, ID_CHIP, PILL, type PillTone } from './kitStyles'
import { formatShortDate } from './dates'
import { formatGap, formatMoney } from './money'

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={PILL[tone]}>{children}</span>
}

/**
 * The confirmation state beside every Posted figure (D59; posted-words.html E): awaiting tonight's
 * sync · ✓ confirmed (date) · CampMinder shows $X · short/over $Y · not in CampMinder · reversed
 * (date). CampMinder's own figure appears only when it disagrees. The gap is exact to the cent (D74).
 */
export function ConfirmationState({ confirmation }: { confirmation: ConfirmationOut }) {
  const on = confirmation.on ? ` ${formatShortDate(confirmation.on)}` : ''
  switch (confirmation.status) {
    case 'awaiting_sync':
      return <StatusPill tone="muted">awaiting tonight&apos;s sync</StatusPill>
    case 'confirmed':
      return <StatusPill tone="emerald">✓ confirmed{on}</StatusPill>
    case 'short':
    case 'over':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
          <span className="text-muted-foreground">
            CampMinder shows {formatMoney(confirmation.in_campminder)}
          </span>
          <StatusPill tone="amber">
            {formatGap(confirmation.locked, confirmation.in_campminder)}
          </StatusPill>
        </span>
      )
    case 'not_in_campminder':
      return <StatusPill tone="amber">not in CampMinder</StatusPill>
    case 'reversed':
      return <StatusPill tone="stone">reversed{on}</StatusPill>
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
