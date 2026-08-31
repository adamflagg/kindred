/**
 * The board's stats-bar cabin-weekend chip — Home 1 in the approved design
 * (kindred#2648 UI half). A pill chip, amber tone, `SharePreferenceChip.tsx`
 * grammar (`inline-flex items-center rounded-full px-2 py-0.5 text-xs
 * font-semibold`); opens the detail modal on click (Q1/Q2/Q3, all decided
 * 2026-08-31).
 *
 * Renders nothing at `count === 0` — an empty amber warning would read as an
 * alarm about nothing, the same reasoning `PushWriteInsEntry`'s greyed (never
 * hidden) badge does NOT need here: that button stays visible because the
 * report behind it is still worth reading at zero. This chip's only content
 * IS the count, so at zero there is nothing left to show.
 */
const AMBER_PILL =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold gap-1 cursor-pointer transition-opacity hover:opacity-80 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'

export interface CabinWeekendChipProps {
  /** Open (unconfirmed, non-stale) rows whose candidates include this weekend. */
  count: number
  onClick: () => void
}

export function CabinWeekendChip({ count, onClick }: CabinWeekendChipProps) {
  if (count === 0) return null

  return (
    <button type="button" onClick={onClick} className={AMBER_PILL}>
      <span aria-hidden="true">⚠</span>
      {count} cabin{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a weekend
    </button>
  )
}
