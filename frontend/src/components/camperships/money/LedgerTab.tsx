import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidBudget } from '../../../hooks/camperships/useAidBudget'
import { useAidSummary } from '../../../hooks/camperships/useAidSummary'
import { useAidToPlace } from '../../../hooks/camperships/useAidToPlace'
import type { ApiAidProgramSplit, ApiAidSummary } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { AidToolbar } from '../kit/Toolbar'
import { CS_BAND_WARN, CS_LABEL, CS_OK_BG, CS_OK_INK, CS_PMETA } from '../kit/csType'
import { DefRef } from '../kit/DefinitionNotes'
import { formatLongDate } from '../kit/dates'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { LedgerFamilies } from './LedgerFamilies'
import { useLedgerNotes, type NoteMark } from './useLedgerNotes'
import {
  footWords,
  hasUnclassified,
  pivotRows,
  splitWords,
  summaryCsvName,
  programChoicesOf,
  programLabelsOf,
  summaryProgramWords,
  tieOut,
  gapReachesNotReconciled,
  tieOutWords,
  type TieOut,
} from './ledgerModel'

/** A money column whose footer is the server's season figure, never a sum of the rows shown. */
function moneyColumn(
  key: string,
  header: string,
  value: (r: ApiAidProgramSplit) => number,
  season: number,
  mark: NoteMark | null
): AidColumn<ApiAidProgramSplit> {
  return {
    key,
    header,
    width: 160,
    align: 'right',
    value,
    render: (r) => <Money value={value(r)} />,
    csv: (r) => moneyCsv(value(r)),
    mark: mark ?? undefined,
    // `total` (not `footerNote`) so the kit draws the footer row; it returns the server's figure
    // for the season, ignoring the rows shown (D21).
    total: () => season,
  }
}

/** The two no-program buckets, muted: money on a household, not on a request (mock `programSection`). */
const BUCKET_TITLES: Readonly<Record<string, string>> = {
  ambiguous: 'Household level: money on a household, not on a request',
  unattributed: 'Not placed: money with no request behind it',
}

function pivotColumns(
  data: ApiAidSummary,
  marks: ReturnType<typeof useLedgerNotes>
): ReadonlyArray<AidColumn<ApiAidProgramSplit>> {
  return [
    {
      key: 'program',
      header: 'Program',
      width: 260,
      pinned: true,
      value: (r) => summaryProgramWords(r.program, r.program_label),
      title: (r) => BUCKET_TITLES[r.program] ?? summaryProgramWords(r.program, r.program_label),
      render: (r) =>
        r.program in BUCKET_TITLES ? (
          <span className="text-muted-foreground">
            {summaryProgramWords(r.program, r.program_label)}
          </span>
        ) : (
          summaryProgramWords(r.program, r.program_label)
        ),
      searchable: true,
    },
    moneyColumn('camp', 'Camp aid (net)', (r) => r.camp_aid, data.camp_aid ?? 0, marks.camp),
    moneyColumn(
      'outside',
      'Outside grants',
      (r) => r.outside_grants,
      data.outside_grants ?? 0,
      marks.outside
    ),
    ...(hasUnclassified(data)
      ? [
          moneyColumn(
            'unclassified',
            'Unclassified',
            (r) => r.unclassified,
            data.unclassified ?? 0,
            marks.unclassified
          ),
        ]
      : []),
    { ...moneyColumn('total', 'Total', (r) => r.total, data.total_aid, null), flex: true },
  ]
}

const TIE_BOX =
  'box-border inline-flex max-w-full items-baseline gap-x-2 rounded-lg border px-2.5 py-[3px] text-[13.5px] leading-[19px] whitespace-nowrap'
const TIE_LINK = 'font-semibold underline underline-offset-2'

/**
 * The figures of a tie-out sentence in bold (mock `tieOut`: `<b>`); `$N apart` is the gap, in the warn ink.
 * A figure is formatMoney's: whole dollars, with cents only where it has them ($2,399.72).
 */
function emphasised(words: string): ReactNode[] {
  return words.split(/(\$[\d,]+(?:\.\d{2})? apart|\$[\d,]+(?:\.\d{2})?)/).map((part, i) => {
    if (/^\$[\d,]+(?:\.\d{2})? apart$/.test(part)) {
      return (
        <span key={i} data-gap className="font-bold text-amber-700 dark:text-amber-300">
          {part}
        </span>
      )
    }
    return /^\$[\d,]+(?:\.\d{2})?$/.test(part) ? (
      <b key={i} className="font-bold tabular-nums">
        {part}
      </b>
    ) : (
      part
    )
  })
}

/**
 * The one line that ties the Ledger to Season › Rounds & budget (owner 10-08, Q6; §9): a forest box
 * with a check when camp aid counting toward the budget equals Posted, an amber box with ⚠ and the
 * gap when it does not. One line, marked with its note.
 */
function TieOutLine({
  view,
  verdict,
  openCount,
  openTotal,
  mark,
}: {
  view: AidView
  verdict: TieOut
  openCount: number | null
  openTotal: number | null
  mark: NoteMark | null
}) {
  const words = tieOutWords(verdict, openCount)
  const note = mark === null ? null : <DefRef n={mark.n} title={mark.title} />
  if (verdict.kind === 'match') {
    const [before = '', matches = ''] = words.split(' · matches ')
    return (
      <div>
        <p
          data-testid="tie-out"
          className={`${TIE_BOX} border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] ${CS_OK_BG} ${CS_OK_INK}`}
        >
          <span>
            {emphasised(before)} ·{' '}
            <Link to={aidHref('/aid/season/rounds-budget', view)} className={TIE_LINK}>
              {emphasised(`matches ${matches}`)}
            </Link>{' '}
            <span className="font-bold">✓</span>
            {note}
          </span>
        </p>
      </div>
    )
  }
  const [before = '', after = ''] = words.split(' → see To place')
  return (
    <div>
      <p
        data-testid="tie-out"
        className={`${TIE_BOX} border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200 ${CS_BAND_WARN}`}
      >
        <span>
          {'⚠ '}
          {emphasised(before)} →{' '}
          <Link to={aidHref('/aid/money/to-place', view)} className={TIE_LINK}>
            see To place{after}
          </Link>
          {gapReachesNotReconciled(verdict, openTotal) && (
            <>
              {' '}
              ·{' '}
              <Link
                to={aidHref('/aid/requests', view, { view: 'not-reconciled' })}
                className={TIE_LINK}
              >
                see Requests › Not reconciled
              </Link>
            </>
          )}
          {note}
        </span>
      </p>
    </div>
  )
}

/**
 * Money › Ledger (spec §8.1; D58, D151; P-11, P-22, ruling F): one row per family whose totals open
 * their lines (`LedgerFamilies`), and under it finance's posted totals (F10), folding, as money-v2
 * draws them: camp aid, outside grants and the total per program, from `GET /summary`, live or by
 * the page's past day.
 */
export function LedgerTab({ view }: { view: AidView }) {
  const summary = useAidSummary()
  const names = useAidProgramNames()
  const budget = useAidBudget()
  const toPlace = useAidToPlace(null)
  const [open, setOpen] = useState(true)
  const past = view.asOf.kind === 'past' ? view.asOf : null
  const data = summary.data
  const marks = useLedgerNotes(data !== undefined && hasUnclassified(data))
  const rows = useMemo(() => (data ? pivotRows(data, names) : []), [data, names])
  const columns = useMemo(
    () => (data ? pivotColumns(data, marks) : []),
    // The marks are rebuilt each render; their numbers and words are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, marks.camp?.n, marks.outside?.n, marks.unclassified?.n]
  )
  const programLabels = useMemo(() => programLabelsOf(data), [data])
  const programChoices = useMemo(() => (data ? programChoicesOf(data, names) : []), [data, names])

  // The section's heading row (§19): the fold caret is its close control, its Download CSV sits on
  // the same row (the table's own toolbar, once the table is drawn).
  const heading = (
    <>
      {/* A button, not an h3: bare headings are styled outside the cascade layers (csType.ts). */}
      <button
        type="button"
        className={`${CS_LABEL} hover:underline`}
        title={`${open ? 'Fold' : 'Open'} the totals by program and source`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Posted in CampMinder by program and source
      </button>
      <span className={`${CS_PMETA} font-normal`}>
        {past === null
          ? 'today · all families'
          : `as of ${formatLongDate(past.date)} · all families`}
      </span>
    </>
  )

  return (
    <div className="space-y-3">
      <LedgerFamilies
        view={view}
        unclassified={data?.unclassified}
        programLabels={programLabels}
        programChoices={programChoices}
      />
      {/* The summary only goes by CampMinder's posting date; on the as-recorded axis the budget
          would be read on a different basis, so the two figures can't be compared. */}
      {data && budget.data && past?.axis !== 'recorded' && (
        <TieOutLine
          view={view}
          verdict={tieOut(data, budget.data)}
          // To place reads today only: on a past date its count and total are not that day's.
          openCount={past === null ? (toPlace.data?.open_count ?? null) : null}
          openTotal={past === null ? (toPlace.data?.open_total ?? null) : null}
          mark={marks.tieOut}
        />
      )}
      <section className="space-y-2">
        {(!open || data === undefined) && <AidToolbar left={heading} />}
        {open && (
          <QueryGuard
            isLoading={summary.isLoading}
            // Owner ruling Group 5: a failed background refetch keeps what loaded.
            error={summary.data ? null : summary.error}
            data={summary.data}
            label="posted totals"
          >
            {(loaded) => {
              const split = splitWords(loaded)
              return (
                <div className="space-y-2">
                  <AidTable
                    rows={rows}
                    columns={columns}
                    rowKey={(r) => r.program}
                    hideSearch
                    toolbarLead={heading}
                    urlPrefix="f10_"
                    csvFilename={summaryCsvName(view.year, past?.date ?? null)}
                    footerLabel={() => 'All programs'}
                    emptyText="Nothing posted this season yet."
                  />
                  <p className={CS_PMETA}>{footWords(loaded)}</p>
                  {split !== null && <p className={CS_PMETA}>{split}</p>}
                  {past?.axis === 'recorded' && (
                    <p className={CS_PMETA}>
                      These totals go by CampMinder&apos;s posting date; they have no &quot;as
                      recorded&quot; view.
                    </p>
                  )}
                </div>
              )
            }}
          </QueryGuard>
        )}
      </section>
      <AidDefinitionNotes surface="money-ledger" extra={marks.extra} boldTerm />
    </div>
  )
}
