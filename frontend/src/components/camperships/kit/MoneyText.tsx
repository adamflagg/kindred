import { NEGATIVE_INK, POOL_NEGATIVE_INK } from './aidStyles'
import { formatShortDate } from './dates'
import { formatMoney, formatMoneyCompact, isNegativeMoney } from './money'

interface MoneyProps {
  value: number | null | undefined
  className?: string | undefined
  /** A pool's Remaining: its negative reads amber (D74 amended), every other negative red. */
  tone?: 'pool' | undefined
}

function classes(
  value: number | null | undefined,
  className: string | undefined,
  tone: MoneyProps['tone']
): string {
  const negative = isNegativeMoney(value)
    ? tone === 'pool'
      ? POOL_NEGATIVE_INK
      : NEGATIVE_INK
    : ''
  return ['tabular-nums', negative, className ?? ''].filter(Boolean).join(' ')
}

/** A money figure as D74 rules: "—" or "$0" or "$1,800", a negative in red (a pool's in amber). */
export function Money({ value, className, tone }: MoneyProps) {
  return <span className={classes(value, className, tone)}>{formatMoney(value)}</span>
}

/** The Remaining line's "$153k" (Decision 2). */
export function MoneyCompact({ value, className, tone }: MoneyProps) {
  return <span className={classes(value, className, tone)}>{formatMoneyCompact(value)}</span>
}

/** D74, D54: a reversed line stays one row, its amount struck through, left out of every net. */
export function ReversedAmount({ value, reversedOn }: { value: number; reversedOn: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <s className="tabular-nums">{formatMoney(value)}</s>
      <span className="text-muted-foreground text-xs">reversed {formatShortDate(reversedOn)}</span>
    </span>
  )
}
