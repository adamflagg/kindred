import type { YearMetrics } from '../../types/metrics'
import { useTableSort } from '../../hooks/useTableSort'
import { DELTA_INK, deltaInk } from '../../utils/deltaTokens'
import {
  formatCount,
  formatPercent,
  formatSignedCount,
  formatSignedPercent,
} from '../../utils/numberFormat'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../utils/priorityDay'
import { DefinitionNotes, DefRef, type DefinitionNote } from '../camperships/kit/DefinitionNotes'
import { CANCELLED_FINAL_NOTE, CANCEL_RATE_NOTE } from '../../pages/metrics/cancelledNotes'
import { MetricSortHeader } from './MetricSortHeader'
import { TableExportButtons } from './TableExportButtons'
import { csvFilename } from './exportFilename'

/** The live season's comparison, read at the same registration day last year (decision 7, ruling #66). */
export interface LiveCompare {
  /** The season still registering (the newest row). */
  year: number
  priorYear: number
  /** Last year's total as it stood on the same registration day. */
  priorTotal: number
  /** That registration day, YYYY-MM-DD. */
  asOf: string
  /** The priority date itself: the figure waits a day (ruling 9). */
  pending: boolean
}

type Field =
  | 'year'
  | 'total'
  | 'change'
  | 'new'
  | 'returning'
  | 'newPct'
  | 'male'
  | 'female'
  | 'cancelled'
  | 'cancelPct'

export interface YearRow {
  year: number
  total: number
  /** Total minus the year before's final, or minus last year at the same point on the live row. */
  change: number | null
  changePct: number | null
  basis: 'final' | 'same point' | null
  pending: boolean
  newCount: number
  returning: number
  newPct: number
  male: number
  female: number
  cancelled: number | null
  cancelPct: number | null
}

/** Rows oldest first, each compared with the year before, however the table is later sorted. */
export function buildYearRows(years: readonly YearMetrics[], live: LiveCompare | null): YearRow[] {
  const ordered = [...years].sort((a, b) => a.year - b.year)
  return ordered.map((year, i) => {
    const prev = ordered[i - 1]
    const isLive = live !== null && year.year === live.year
    const base = isLive ? live.priorTotal : (prev?.total_enrolled ?? null)
    const change = base === null ? null : year.total_enrolled - base
    const hasCancel = year.has_cancellation_data !== false
    return {
      year: year.year,
      total: year.total_enrolled,
      change,
      changePct: change === null || !base ? null : (change / base) * 100,
      basis: change === null ? null : isLive ? 'same point' : 'final',
      pending: isLive && live.pending,
      newCount: year.new_vs_returning.new_count,
      returning: year.new_vs_returning.returning_count,
      newPct: year.new_vs_returning.new_percentage,
      male: year.by_gender.find((g) => g.gender === 'M')?.count ?? 0,
      female: year.by_gender.find((g) => g.gender === 'F')?.count ?? 0,
      cancelled: hasCancel ? (year.total_cancelled ?? 0) : null,
      cancelPct: hasCancel ? (year.cancellation_rate ?? 0) : null,
    }
  })
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const VS_FINAL_NOTE =
  'Total against the year before, always, however the table is sorted. “Final” is that year’s end-of-season total, because families come off waitlists until the day before a session starts.'

function liveNote(live: LiveCompare): string {
  const day = MONTH_DAY.format(new Date(`${live.asOf}T00:00:00Z`))
  return `${String(live.year)} is still registering, so it is compared with ${String(live.priorYear)} at the same registration day (${day}). Earlier rows compare final to final.`
}

/** Notes 1-3 are the column notes; the live row's follows them (ruling #66). */
function yearNotes(live: LiveCompare | null): DefinitionNote[] {
  return [
    { n: 1, term: 'vs final', text: VS_FINAL_NOTE },
    { n: 2, term: 'Cancelled', text: CANCELLED_FINAL_NOTE },
    { n: 3, term: 'Cancel %', text: CANCEL_RATE_NOTE },
    ...(live ? [{ n: 4, text: liveNote(live) }] : []),
  ]
}

const LIVE_NOTE_N = 4

function ChangeCell({ row }: { row: YearRow }) {
  if (row.change === null) return <span className="text-muted-foreground">—</span>
  if (row.pending) return <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>
  const ink = row.change === 0 ? DELTA_INK.neutral : deltaInk(row.change, 'up-good')
  return (
    <span className={`tabular-nums ${ink}`}>
      {row.change > 0 ? '▲ ' : row.change < 0 ? '▼ ' : ''}
      {formatSignedCount(row.change)}
      {row.changePct !== null && <> ({formatSignedPercent(row.changePct)})</>}
      {row.basis === 'same point' && <DefRef n={LIVE_NOTE_N} />}
    </span>
  )
}

function sortValue(row: YearRow, field: Field) {
  switch (field) {
    case 'year':
      return row.year
    case 'total':
      return row.total
    case 'change':
      return row.change
    case 'new':
      return row.newCount
    case 'returning':
      return row.returning
    case 'newPct':
      return row.newPct
    case 'male':
      return row.male
    case 'female':
      return row.female
    case 'cancelled':
      return row.cancelled
    case 'cancelPct':
      return row.cancelPct
  }
}

const oneDecimal = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

/**
 * Trends › Year-by-Year Summary (#3207 PR 10): sortable, with Copy and Download CSV, and a "vs final"
 * column after Total, a number and a percent in the shared change colours (rulings #66-#67).
 */
export function YearByYearTable({
  years,
  live,
}: {
  years: readonly YearMetrics[]
  live: LiveCompare | null
}) {
  const natural = buildYearRows(years, live)
  const sort = useTableSort<Field>('year')
  const rows = sort.apply(natural, sortValue)
  const newest = natural.at(-1)?.year ?? 0

  const h = (label: string, field: Field, align: 'left' | 'right' = 'right', mark?: number) => (
    <MetricSortHeader
      label={label}
      align={align}
      direction={sort.direction(field)}
      onSort={() => sort.toggle(field)}
      labelSuffix={mark === undefined ? undefined : <DefRef n={mark} />}
    />
  )

  return (
    <>
      <div data-tour="trends-table" className="card-lodge overflow-hidden">
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">Year-by-Year Summary</h3>
          <TableExportButtons
            filename={csvFilename(newest, 'Trends year-by-year')}
            headers={[
              'Year',
              'Total',
              'Change vs prior year',
              'Change vs prior year %',
              'Change basis',
              'New',
              'Returning',
              'New %',
              'Male',
              'Female',
              'Cancelled',
              'Cancel %',
            ]}
            rows={rows.map((r) => [
              r.year,
              r.total,
              r.pending ? null : r.change,
              r.pending ? null : oneDecimal(r.changePct),
              r.basis,
              r.newCount,
              r.returning,
              oneDecimal(r.newPct),
              r.male,
              r.female,
              r.cancelled,
              oneDecimal(r.cancelPct),
            ])}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                {h('Year', 'year', 'left')}
                {h('Total', 'total')}
                {h('vs final', 'change', 'right', 1)}
                {h('New', 'new')}
                {h('Returning', 'returning')}
                {h('New %', 'newPct')}
                {h('Male', 'male')}
                {h('Female', 'female')}
                {h('Cancelled', 'cancelled', 'right', 2)}
                {h('Cancel %', 'cancelPct', 'right', 3)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.year}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">{r.year}</td>
                  <td className="text-foreground px-4 py-3 text-right">{formatCount(r.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <ChangeCell row={r} />
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {formatCount(r.newCount)}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {formatCount(r.returning)}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-right">
                    {formatPercent(r.newPct)}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">{formatCount(r.male)}</td>
                  <td className="text-foreground px-4 py-3 text-right">{formatCount(r.female)}</td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {r.cancelled === null ? '—' : formatCount(r.cancelled)}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-right">
                    {r.cancelPct === null ? '—' : formatPercent(r.cancelPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DefinitionNotes notes={yearNotes(live)} boldTerm />
    </>
  )
}
