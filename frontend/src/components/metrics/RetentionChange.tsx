/**
 * The change figure on Retention's breakdowns (#3207 PR 11): every chart and table that compares
 * with last year uses this cell, header and legend, so the wording, the small-row rule (#91) and
 * the delta ink are one thing.
 */
import { DefRef } from '../camperships/kit/DefinitionNotes'
import { DELTA_INK, deltaInk } from '../../utils/deltaTokens'
import { formatCount } from '../../utils/numberFormat'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../utils/priorityDay'
import {
  changeArrow,
  formatSignedPoints,
  formatSignedPointsBare,
  isSmallBase,
  pointsBetween,
  type RetentionCompareView,
} from '../../utils/retentionCompare'

/** One row's change against last year. */
export function RetentionChange({
  rate,
  priorRate,
  baseCount,
  compare,
  showCount = false,
  compact = false,
  suffix = '',
}: {
  rate: number
  priorRate: number | null | undefined
  baseCount: number
  compare: RetentionCompareView
  /** Only where the row shows its base nowhere else (#91: never restate a visible base). */
  showCount?: boolean
  /** A narrow chart face: the unit drops ("+2.2"); the tooltip keeps the words. */
  compact?: boolean
  /** Words after the figure, inside its ink (the headline's " vs final", #85). */
  suffix?: string
}) {
  const points = pointsBetween(rate, priorRate)
  if (points === null) return <span className={DELTA_INK.neutral}>—</span>
  if (compare.pending)
    return <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>

  const small = isSmallBase(baseCount)
  const value = compact ? formatSignedPointsBare(points) : formatSignedPoints(points)
  const count = showCount
    ? compact
      ? ` · ${formatCount(baseCount)}`
      : ` · ${formatCount(baseCount)} campers`
    : ''
  // #91: a small row keeps its change, muted and without the arrow, so it reads as a soft figure
  if (small)
    return <span className={`${DELTA_INK.neutral} font-normal`}>{`${value}${count}${suffix}`}</span>
  return (
    <span className={`${deltaInk(points, 'up-good')} font-medium`}>
      {`${changeArrow(points)}${value}${count}${suffix}`}
    </span>
  )
}

/** "Change vs same point last year¹": heads a compared chart or column. */
export function RetentionCompareHeader({ compare }: { compare: RetentionCompareView }) {
  return (
    <span className="text-muted-foreground text-xs font-medium whitespace-nowrap">
      Change {compare.label}
      <DefRef n={compare.noteN} />
    </span>
  )
}

/** Names this year's bars (or line) and last year's mark (or dashed line). */
export function RetentionCompareLegend({
  compare,
  kind = 'bar',
}: {
  compare: RetentionCompareView
  kind?: 'bar' | 'line'
}) {
  return (
    <div className="text-muted-foreground mt-2 flex flex-wrap justify-center gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        {kind === 'bar' ? (
          <span className="bg-muted-foreground/50 inline-block h-3 w-2.5 rounded-t-sm" />
        ) : (
          <span className="inline-block h-0.5 w-4 bg-[hsl(160,100%,35%)]" />
        )}
        <span>{compare.nowLegend}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {kind === 'bar' ? (
          <span className="bg-foreground inline-block h-0.5 w-3.5" />
        ) : (
          <span className="border-muted-foreground inline-block w-4 border-t-2 border-dashed" />
        )}
        <span>{compare.priorLegend}</span>
      </span>
    </div>
  )
}
