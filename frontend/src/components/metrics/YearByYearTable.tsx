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
import { AnotherIdentityLine, GenderFallbackSeasonsLine, genderNote } from './genderIdentityNotes'
import { GENDER_IDENTITY_GROUPS, genderDisplayName } from '../camperships/kit/genderIdentity'
import { buildYearRows, type LiveCompare, type YearRow } from './yearByYearRows'
import { MetricSortHeader } from './MetricSortHeader'
import { TableExportButtons } from './TableExportButtons'
import { csvFilename } from './exportFilename'

type Field =
  | 'year'
  | 'total'
  | 'change'
  | 'new'
  | 'returning'
  | 'newPct'
  | `g:${string}`
  | 'cancelled'
  | 'cancelPct'

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

/** How many notes the table's own columns carry; the Gender note (#2898) follows them. */
export function yearNoteCount(live: LiveCompare | null): number {
  return live ? 4 : 3
}

const GENDER_AFTER =
  ' CampMinder holds few identity answers before 2023, so an early season’s split is mostly the Gender field.'

/** Notes 1-3 are the column notes; the live row's follows them (ruling #66), then the Gender note (#2898). */
function yearNotes(
  live: LiveCompare | null,
  fallbackSeasons: ReadonlyArray<{ season: number; count: number; of: number }>
): DefinitionNote[] {
  const hasFallback = fallbackSeasons.some((s) => s.count > 0)
  return [
    { n: 1, term: 'vs final', text: VS_FINAL_NOTE },
    { n: 2, term: 'Cancelled', text: CANCELLED_FINAL_NOTE },
    { n: 3, term: 'Cancel %', text: CANCEL_RATE_NOTE },
    ...(live ? [{ n: 4, text: liveNote(live) }] : []),
    ...(hasFallback ? [genderNote(yearNoteCount(live) + 1, fallbackSeasons, GENDER_AFTER)] : []),
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
      // On the priority date the cell reads "updates tomorrow", so it sorts with the blanks.
      return row.pending ? null : row.change
    case 'new':
      return row.newCount
    case 'returning':
      return row.returning
    case 'newPct':
      return row.newPct
    case 'cancelled':
      return row.cancelled
    case 'cancelPct':
      return row.cancelPct
    default:
      return row.groups[field.slice(2)] ?? 0
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
  const fallbackSeasons = years.map((y) => ({
    season: y.year,
    count: y.gender_fallback_count ?? 0,
    of: y.total_enrolled,
  }))
  const genderN = fallbackSeasons.some((x) => x.count > 0) ? yearNoteCount(live) + 1 : undefined
  const tableGroups = GENDER_IDENTITY_GROUPS.filter((g) =>
    natural.some((r) => (r.groups[g] ?? 0) > 0)
  )
  const fallbackByYear = new Map(fallbackSeasons.map((x) => [x.season, x.count]))
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
              ...tableGroups.map((g) => genderDisplayName(g)),
              'Cancelled',
              'Cancel %',
            ]}
            rows={rows.map((r) => [
              r.year,
              r.total,
              r.pending ? null : r.change,
              r.pending ? null : oneDecimal(r.changePct),
              r.pending ? null : r.basis,
              r.newCount,
              r.returning,
              oneDecimal(r.newPct),
              ...tableGroups.map((g) => r.groups[g] ?? 0),
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
                {tableGroups.map((g) => h(genderDisplayName(g), `g:${g}`))}
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
                  <td className="text-foreground px-4 py-3 font-medium">
                    {r.year}
                    {genderN !== undefined && (fallbackByYear.get(r.year) ?? 0) > 0 && (
                      <DefRef n={genderN} />
                    )}
                  </td>
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
                  {tableGroups.map((g) => (
                    <td key={g} className="text-foreground px-4 py-3 text-right">
                      {formatCount(r.groups[g] ?? 0)}
                    </td>
                  ))}
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
        <div className="px-4 pb-3">
          <AnotherIdentityLine counts={rows.map((r) => r.groups)} />
          {genderN !== undefined && (
            <GenderFallbackSeasonsLine n={genderN} seasons={fallbackSeasons} />
          )}
        </div>
      </div>
      <DefinitionNotes notes={yearNotes(live, fallbackSeasons)} boldTerm />
    </>
  )
}
