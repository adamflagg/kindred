/**
 * Does this weekend fit in the site, and what don't we know?
 *
 * A camper list cannot ask this — campers do not consume a fixed pool. A
 * weekend does: a set number of cabins, a set number of beds, one date.
 *
 * The measure carries three bands, and the third is the point of the whole
 * component. Beds needed, beds still free, and a hatched INDETERMINATE band
 * standing for cabins nobody has measured. Most dashboards would round that
 * to zero and report a clean number; this one shows it, because "389 beds"
 * and "389 beds plus five cabins nobody has measured" are different facts and
 * staff plan differently under each.
 */

export interface CapacityLedgerProps {
  bedsNeeded: number
  bedsAvailable: number
  cabinsUnmeasured: number
}

export function CapacityLedger({
  bedsNeeded,
  bedsAvailable,
  cabinsUnmeasured,
}: CapacityLedgerProps) {
  const shortfall = Math.max(0, bedsNeeded - bedsAvailable)
  const isShort = shortfall > 0
  const hasUnmeasured = cabinsUnmeasured > 0

  // The hatched band is deliberately a fixed slice rather than a scaled one:
  // its width cannot be honest, because its size is exactly what is unknown.
  const unmeasuredWidth = hasUnmeasured ? 12 : 0
  const measuredWidth = 100 - unmeasuredWidth
  const filledPercent =
    bedsAvailable > 0 ? Math.min(100, (bedsNeeded / bedsAvailable) * 100) : bedsNeeded > 0 ? 100 : 0

  const fillTone = isShort ? 'bg-red-500 dark:bg-red-500/80' : 'bg-forest-500 dark:bg-forest-400'

  const label = `${String(bedsNeeded)} of ${String(bedsAvailable)} beds needed${
    hasUnmeasured
      ? `, plus ${String(cabinsUnmeasured)} cabin${cabinsUnmeasured === 1 ? '' : 's'} of unknown capacity`
      : ''
  }`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <span
          className="font-display text-foreground text-5xl leading-none font-bold tabular-nums"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {bedsNeeded}
        </span>
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold">beds needed</span>
          <span className="text-muted-foreground text-xs">of {bedsAvailable} available</span>
        </div>
      </div>

      <div
        role="img"
        aria-label={label}
        className="bg-muted/70 flex h-2.5 w-full overflow-hidden rounded-full"
      >
        <div className="relative flex" style={{ width: `${String(measuredWidth)}%` }}>
          <div
            className={`h-full rounded-l-full transition-[width] duration-500 ${fillTone}`}
            style={{ width: `${String(filledPercent)}%` }}
          />
        </div>
        {hasUnmeasured && (
          <div
            className="h-full border-l border-white/40 dark:border-black/30"
            style={{
              width: `${String(unmeasuredWidth)}%`,
              backgroundImage:
                'repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 6px)',
              color: 'var(--color-bark-400)',
              opacity: 0.75,
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {isShort && (
          <span className="font-semibold text-red-700 dark:text-red-400">
            {shortfall} beds short
          </span>
        )}
        {hasUnmeasured && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 6px)',
                color: 'var(--color-bark-400)',
              }}
            />
            {cabinsUnmeasured} cabin{cabinsUnmeasured === 1 ? '' : 's'} unmeasured
          </span>
        )}
      </div>
    </div>
  )
}
