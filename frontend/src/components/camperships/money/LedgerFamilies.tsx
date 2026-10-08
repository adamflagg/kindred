import { Fragment, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidMoneyLedger } from '../../../hooks/camperships/useAidMoneyLedger'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSources } from '../../../hooks/camperships/useAidSources'
import type { ApiAidLedgerFamily, ApiAidLedgerTotal } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { CS_INPUT, CS_LINK, CS_PMETA } from '../kit/csType'
import { familyLabel } from '../kit/familyLabel'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { programLabel } from '../requests/programLabel'
import {
  LEDGER_LEVEL_TONE,
  LEDGER_LEVEL_WORDS,
  LEDGER_LEVELS,
  LEDGER_TOTAL_WORDS,
  ledgerCsvName,
  linesWords,
  parseLedgerFilters,
  parseLinesTotal,
  sourceFamilyOptions,
} from './ledgerFamiliesModel'
import { LedgerLines } from './LedgerLines'
import { keyWords, PROGRAM_FAMILIES } from './sourcesModel'

type LedgerParam = 'source' | 'program' | 'level' | 'lines'

const familyKey = (r: ApiAidLedgerFamily) => String(r.household_cm_id)
const labelOfRow = (r: ApiAidLedgerFamily) => familyLabel(r, r.display_name)
const searchIds = (r: ApiAidLedgerFamily) => [r.household_cm_id]
/** R-D: the household id is not drawn under the name, but the CSV carries it. */
const CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidLedgerFamily>> = [
  { header: 'Household CM id', value: (r) => String(r.household_cm_id) },
]
const TOTALS: readonly ApiAidLedgerTotal[] = ['in_campminder_net', 'outside_grants']

/**
 * Money › Ledger's family rows (spec §8.1; D26, D59, D97, D151; P-22, R-D, ruling F;
 * money-v2.html Ledger): one row per family named by the household page's label, In CampMinder
 * (net) and Outside grants as the server sends them, and the level as a pill only where the money
 * isn't on a request. Source, Program and Level go to the server (`?source=`, `?program=`,
 * `?level=`); the family opens its household page. Under the table, the server's two totals, each
 * opening the lines behind it (`?lines=`).
 */
export function LedgerFamilies({ view }: { view: AidView }) {
  const [params, setParams] = useSearchParams()
  const filters = parseLedgerFilters(params)
  const openTotal = parseLinesTotal(params.get('lines'))
  const ledger = useAidMoneyLedger(filters)
  const sources = useAidSources()
  const names = useAidProgramNames()
  const setParam = useCallback(
    (name: LedgerParam, value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null || value === '') next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const sourceOptions = useMemo(
    () => sourceFamilyOptions(sources.data?.sources ?? []),
    [sources.data]
  )
  // R3-3: the lines card names each line's family by its row here (no label on the lines read).
  const byFamily = useMemo(
    () => new Map((ledger.data?.rows ?? []).map((r) => [r.household_cm_id, r] as const)),
    [ledger.data]
  )
  const familyOf = useCallback((id: number) => byFamily.get(id), [byFamily])
  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidLedgerFamily>> => [
      {
        key: 'family',
        header: 'Family',
        width: 200,
        pinned: true,
        value: (r) => labelWords(labelOfRow(r)),
        render: (r) => (
          <Link
            className={CS_LINK}
            to={aidHref(`/aid/households/${String(r.household_cm_id)}`, view)}
            onClick={(event) => event.stopPropagation()}
          >
            <HouseholdLabelText label={labelOfRow(r)} />
          </Link>
        ),
        searchable: true,
      },
      {
        key: 'campers',
        header: 'Campers',
        width: 220,
        value: (r) => r.campers.join(', '),
        searchable: true,
      },
      {
        key: 'camp',
        header: 'In CampMinder (net)',
        width: 160,
        align: 'right',
        value: (r) => r.in_campminder_net,
        render: (r) => <Money value={r.in_campminder_net} />,
        csv: (r) => moneyCsv(r.in_campminder_net),
      },
      {
        key: 'outside',
        header: 'Outside grants',
        width: 140,
        align: 'right',
        value: (r) => r.outside_grants,
        render: (r) => <Money value={r.outside_grants} />,
        csv: (r) => moneyCsv(r.outside_grants),
      },
      {
        key: 'lines',
        header: 'Lines',
        width: 120,
        value: (r) => linesWords(r.lines, r.reversed_lines),
      },
      {
        key: 'level',
        header: "Level, where it isn't a request",
        flex: true,
        value: (r) => (r.level === null ? '' : LEDGER_LEVEL_WORDS[r.level]),
        render: (r) =>
          r.level === null ? (
            ''
          ) : (
            <StatusPill tone={LEDGER_LEVEL_TONE[r.level]}>{LEDGER_LEVEL_WORDS[r.level]}</StatusPill>
          ),
      },
    ],
    [view]
  )

  const select = (
    name: 'source' | 'program' | 'level',
    label: string,
    value: string | null,
    options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  ) => (
    <label className="flex items-center gap-1.5 text-xs">
      {label}
      <select
        className={CS_INPUT}
        value={value ?? ''}
        onChange={(event) => setParam(name, event.target.value)}
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {select(
        'source',
        'Source',
        filters.source,
        sourceOptions.map((s) => ({ value: s, label: keyWords(s) }))
      )}
      {select(
        'program',
        'Program',
        filters.program,
        PROGRAM_FAMILIES.map((p) => ({ value: p, label: programLabel(names, p) }))
      )}
      {select(
        'level',
        'Level',
        filters.level,
        LEDGER_LEVELS.map((l) => ({ value: l, label: LEDGER_LEVEL_WORDS[l] }))
      )}
    </div>
  )
  const asOf = view.asOf.kind === 'past' ? view.asOf.date : null

  return (
    // R3-4: the filters sit outside the QueryGuard (as History and Scenarios do on main), so a
    // filter change never unmounts the select being used.
    <div className="space-y-2">
      {toolbar}
      <QueryGuard
        isLoading={ledger.isLoading}
        // Owner ruling Group 5: a failed background refetch keeps what loaded.
        error={ledger.data ? null : ledger.error}
        data={ledger.data}
        label="Ledger"
      >
        {(data) => (
          <div className="space-y-2">
            <AidTable
              rows={data.rows}
              columns={columns}
              rowKey={familyKey}
              searchExtra={searchIds}
              urlPrefix="ledger_"
              csvFilename={ledgerCsvName(data.year, filters, asOf)}
              csvExtra={CSV_EXTRA}
              searchPlaceholder="Family, camper or CM id"
              emptyText="No family has aid lines for these filters."
            />
            <p className="text-sm" data-testid="ledger-totals">
              <span className="font-medium">
                {`${String(data.rows.length)} ${data.rows.length === 1 ? 'family' : 'families'}`}
              </span>
              {TOTALS.map((total) => (
                <Fragment key={total}>
                  {' · '}
                  <button
                    type="button"
                    className={CS_LINK}
                    onClick={() => setParam('lines', total)}
                  >
                    {`${LEDGER_TOTAL_WORDS[total]} `}
                    <Money value={data[total]} />
                  </button>
                </Fragment>
              ))}
              <span className={`${CS_PMETA} ml-2`}>
                each total opens its lines; the totals follow the filters, not the search
              </span>
            </p>
            {openTotal !== null && (
              <LedgerLines
                key={openTotal}
                total={openTotal}
                filters={filters}
                view={view}
                familyOf={familyOf}
                onClose={() => setParam('lines', null)}
              />
            )}
          </div>
        )}
      </QueryGuard>
    </div>
  )
}
