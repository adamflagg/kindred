import { useMemo, useState } from 'react'

import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSummary } from '../../../hooks/camperships/useAidSummary'
import type { ApiAidProgramSplit, ApiAidSummary } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { CS_LABEL, CS_PMETA } from '../kit/csType'
import { formatLongDate } from '../kit/dates'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { LedgerFamilies } from './LedgerFamilies'
import {
  footWords,
  hasUnclassified,
  pivotRows,
  splitWords,
  summaryCsvName,
  programLabelsOf,
  summaryProgramWords,
} from './ledgerModel'

/** A money column whose footer is the server's season figure, never a sum of the rows shown. */
function moneyColumn(
  key: string,
  header: string,
  value: (r: ApiAidProgramSplit) => number,
  season: number
): AidColumn<ApiAidProgramSplit> {
  return {
    key,
    header,
    width: 160,
    align: 'right',
    value,
    render: (r) => <Money value={value(r)} />,
    csv: (r) => moneyCsv(value(r)),
    // `total` (not `footerNote`) so the kit draws the footer row; it returns the server's figure
    // for the season, ignoring the rows shown (D21).
    total: () => season,
  }
}

function pivotColumns(data: ApiAidSummary): ReadonlyArray<AidColumn<ApiAidProgramSplit>> {
  return [
    {
      key: 'program',
      header: 'Program',
      width: 200,
      pinned: true,
      value: (r) => summaryProgramWords(r.program, r.program_label),
      searchable: true,
    },
    moneyColumn('camp', 'Camp aid (net)', (r) => r.camp_aid, data.camp_aid ?? 0),
    moneyColumn('outside', 'Outside grants', (r) => r.outside_grants, data.outside_grants ?? 0),
    ...(hasUnclassified(data)
      ? [moneyColumn('unclassified', 'Unclassified', (r) => r.unclassified, data.unclassified ?? 0)]
      : []),
    { ...moneyColumn('total', 'Total', (r) => r.total, data.total_aid), flex: true },
  ]
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
  const [open, setOpen] = useState(true)
  const past = view.asOf.kind === 'past' ? view.asOf : null
  const data = summary.data
  const rows = useMemo(() => (data ? pivotRows(data, names) : []), [data, names])
  const columns = useMemo(() => (data ? pivotColumns(data) : []), [data])
  const programLabels = useMemo(() => programLabelsOf(data), [data])

  return (
    <div className="space-y-3">
      <LedgerFamilies view={view} unclassified={data?.unclassified} programLabels={programLabels} />
      <section className="space-y-2">
        {/* A div, not an h3: bare headings are styled outside the cascade layers (csType.ts). */}
        <div className={`flex flex-wrap items-baseline gap-2 ${CS_LABEL}`}>
          <button type="button" className="hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'} Posted in CampMinder by program and source
          </button>
          <span className={`${CS_PMETA} font-normal`}>
            {past === null
              ? 'today · all families'
              : `as of ${formatLongDate(past.date)} · all families`}
          </span>
        </div>
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
      <AidDefinitionNotes surface="money-ledger" />
    </div>
  )
}
