import type { ReactNode } from 'react'

import type { ConfirmationOut } from '../../../types/api-generated'
import { householdChipClass, ID_CHIP, PILL, type PillTone } from './kitStyles'
import { formatShortDate } from './dates'
import { CM_PENDING_WORD } from '../requests/views'
import { formatGap, formatMoney } from './money'

/**
 * A chip (design-language §11): one line, always. In a narrow column it truncates, and `title`
 * carries the full words (owner 10-09: "needs to be one line").
 */
export function StatusPill({
  tone,
  children,
  title,
}: {
  tone: PillTone
  children: ReactNode
  title?: string
}) {
  return (
    <span className={title ? `${PILL[tone]} cursor-help` : PILL[tone]} title={title}>
      {children}
    </span>
  )
}

/**
 * A cancelled grant or request (§11 rev1): a muted stone ⊘ BEFORE the name, never a chip, so a long
 * name cannot push a chip off screen. The cancellation's words ride in the title.
 */
export function CancelMark({ title }: { title: string }) {
  return (
    <span className="mr-1 cursor-help text-stone-500 dark:text-stone-400" title={title}>
      ⊘
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
      return <StatusPill tone="muted">{CM_PENDING_WORD}</StatusPill>
    case 'confirmed':
      return <StatusPill tone="ok">✓ confirmed{on}</StatusPill>
    case 'short':
    case 'over':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">
            CampMinder shows {formatMoney(confirmation.in_campminder)}
          </span>
          <StatusPill tone="amber">
            {formatGap(confirmation.locked, confirmation.in_campminder)}
          </StatusPill>
        </span>
      )
    case 'not_in_campminder':
      return <StatusPill tone="amber">Missing in CM</StatusPill>
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
