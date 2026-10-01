import { NEGATIVE_INK } from './aidStyles'
import { formatShortDate } from './dates'
import { formatMoney, formatMoneyCompact, isNegativeMoney } from './money'

interface MoneyProps {
  value: number | null | undefined
  className?: string | undefined
}

function classes(value: number | null | undefined, className: string | undefined): string {
  return ['tabular-nums', isNegativeMoney(value) ? NEGATIVE_INK : '', className ?? '']
    .filter(Boolean)
    .join(' ')
}

/** A money figure as D74 rules: "—" or "$0" or "$1,800", a negative in red. */
export function Money({ value, className }: MoneyProps) {
  return <span className={classes(value, className)}>{formatMoney(value)}</span>
}

/** The Remaining line's "$153k" (Decision 2). */
export function MoneyCompact({ value, className }: MoneyProps) {
  return <span className={classes(value, className)}>{formatMoneyCompact(value)}</span>
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
