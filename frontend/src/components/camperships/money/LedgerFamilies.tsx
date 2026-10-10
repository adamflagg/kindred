import { Home } from 'lucide-react'
import { useCallback, useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidMoneyLedger } from '../../../hooks/camperships/useAidMoneyLedger'
import { useAidSources } from '../../../hooks/camperships/useAidSources'
import type {
  ApiAidLedgerFamily,
  ApiAidLedgerTotal,
  ApiAidMoneyLedger,
} from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidPicker } from '../kit/AidPicker'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { CS_FLABEL, CS_LINK_CELL, CS_PMETA } from '../kit/csType'
import { familyLabel } from '../kit/familyLabel'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import type { AidPickerOption } from '../kit/pickerWords'
import { StatusPill } from '../kit/Pills'
import { AidToolbar } from '../kit/Toolbar'
import { sentenceCase } from '../kit/words'
import {
  familiesWords,
  footNoteWords,
  householdCampersWords,
  LEDGER_LEVEL_TONE,
  LEDGER_LEVEL_WORDS,
  LEDGER_LEVELS,
  ledgerCsvName,
  linesWords,
  parseLedgerFilters,
  parseLinesTotal,
  sourcePickerOptions,
  totalOpenTitle,
  TOTALS_TIP,
  withAllAndSent,
  type LedgerFilters,
} from './ledgerFamiliesModel'
import { summaryProgramWords } from './ledgerModel'
import { LedgerLines } from './LedgerLines'
import { familyChoices, familyWordsOf } from './sourcesModel'
import { useLedgerNotes } from './useLedgerNotes'

type LedgerParam = 'source' | 'program' | 'level' | 'lines'

const familyKey = (r: ApiAidLedgerFamily) => String(r.household_cm_id)
const labelOfRow = (r: ApiAidLedgerFamily) => familyLabel(r, r.display_name)
const searchIds = (r: ApiAidLedgerFamily) => [r.household_cm_id]
/** R-D: the household id is not drawn under the name, but the CSV carries it. */
const CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidLedgerFamily>> = [
  { header: 'Household CM id', value: (r) => String(r.household_cm_id) },
]
/** The column that opens each total's lines. */
const TOTAL_OF_COLUMN: Readonly<Record<string, ApiAidLedgerTotal>> = {
  camp: 'in_campminder_net',
  outside: 'outside_grants',
}
const householdSessionsOf = (r: ApiAidLedgerFamily) => r.household_sessions ?? []
/** A family whose lines sit on Family Camp household requests (mock `famCell` / `campersCell`). */
const isHousehold = (r: ApiAidLedgerFamily) => householdSessionsOf(r).length > 0
const campersWords = (r: ApiAidLedgerFamily) =>
  isHousehold(r) ? householdCampersWords(r.campers, householdSessionsOf(r)) : r.campers.join(', ')
const campersTitle = (r: ApiAidLedgerFamily) =>
  isHousehold(r)
    ? `${householdSessionsOf(r)
        .map((s) => s.name)
        .join(
          '; '
        )}: a household-level request${r.campers.length === 0 ? ', no camper on the line' : ''}`
    : r.campers.length === 0
      ? NO_CAMPER_TITLE
      : r.campers.join(', ')
const NO_CAMPER_TITLE = 'No camper on these lines: CampMinder posted them to the household'

/**
 * Money › Ledger's family rows (spec §8.1; D26, D59, D97, D151; P-22, R-D, ruling F;
 * money-v2.html Ledger): one row per family named by the household page's label, In CampMinder
 * (net) and Outside grants as the server sends them, and the level as a pill only where the money
 * isn't on a request. Source, Program and Level go to the server (`?source=`, `?program=`,
 * `?level=`); the family opens its household page. The table's total row (final UX ★11) holds the
 * server's two totals, each opening the lines behind it (`?lines=`).
 */
export function LedgerFamilies({
  view,
  unclassified,
  programLabels = {},
  programChoices = [],
}: {
  view: AidView
  /** The program words the summary sends, by key (`program_label`); a key with none reads "Other program". */
  programLabels?: Readonly<Record<string, string>>
  /** The programs with money this season, labelled (`programChoicesOf`); none until the summary loads. */
  programChoices?: ReadonlyArray<{ value: string; label: string }>
  /** The season's unclassified money from `GET /summary` (same as-of); absent until it loads. */
  unclassified?: number | null | undefined
}) {
  const [params, setParams] = useSearchParams()
  const filters = parseLedgerFilters(params)
  const openTotal = parseLinesTotal(params.get('lines'))
  const ledger = useAidMoneyLedger(filters)
  const sources = useAidSources()
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
  const familyOptions = useMemo(() => familyChoices(sources.data?.sources ?? []), [sources.data])
  const sourceOptions = useMemo(
    () =>
      withAllAndSent(
        sourcePickerOptions(familyOptions, filters.source, (unclassified ?? 0) > 0),
        filters.source,
        (key) => familyWordsOf({ source_family: key })
      ),
    [familyOptions, filters.source, unclassified]
  )
  const programOptions = useMemo(
    (): ReadonlyArray<AidPickerOption<string>> =>
      withAllAndSent([{ value: '', label: 'All' }, ...programChoices], filters.program, (key) =>
        summaryProgramWords(key, programLabels[key])
      ),
    [programChoices, programLabels, filters.program]
  )
  const levelOptions = useMemo(
    (): ReadonlyArray<AidPickerOption<string>> => [
      { value: '', label: 'All' },
      ...LEDGER_LEVELS.map((l) => ({ value: l, label: sentenceCase(LEDGER_LEVEL_WORDS[l]) })),
    ],
    []
  )
  // R3-3: the lines card names each line's family by its row here (no label on the lines read).
  const byFamily = useMemo(
    () => new Map((ledger.data?.rows ?? []).map((r) => [r.household_cm_id, r] as const)),
    [ledger.data]
  )
  const familyOf = useCallback((id: number) => byFamily.get(id), [byFamily])

  // Source, Program and Level: the white picker at the toolbar's 96px (§3, §5). They lead the table's
  // own toolbar once it has rows; until then (a first read or a failed one) they stand alone, so a
  // stale filter can still be changed.
  const picker = (
    name: 'source' | 'program' | 'level',
    label: string,
    value: string | null,
    options: ReadonlyArray<AidPickerOption<string>>
  ) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={CS_FLABEL}>{label}</span>
      <AidPicker
        label={label}
        value={value ?? ''}
        options={options}
        onChange={(next) => setParam(name, next)}
        className="w-24 [&>button]:min-w-0 [&>button]:flex-1"
      />
    </span>
  )
  const pickers = (
    <>
      {picker('source', 'Source', filters.source, sourceOptions)}
      {picker('program', 'Program (in CM)', filters.program, programOptions)}
      {picker('level', 'Level', filters.level, levelOptions)}
    </>
  )

  return (
    // R3-4: a refiltered read keeps the old rows (placeholder data), so the pickers in the table's
    // toolbar are never unmounted while one is being used.
    <div className="space-y-2">
      {/* Loading or failed: the pickers alone, above the message; the table's toolbar holds them after. */}
      {ledger.data === undefined && <AidToolbar left={pickers} />}
      <QueryGuard
        isLoading={ledger.isLoading}
        // Owner ruling Group 5: a failed background refetch keeps what loaded.
        error={ledger.data ? null : ledger.error}
        data={ledger.data}
        label="Ledger"
      >
        {(data) => (
          <div className="space-y-2">
            <FamilyTable
              data={data}
              view={view}
              filters={filters}
              unclassified={unclassified}
              pickers={pickers}
              standIn={ledger.isPlaceholderData}
              onOpenTotal={(total) => setParam('lines', total)}
            />
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

/** The family table: bounded (§23), its total row (★11) holding the server's two totals. */
function FamilyTable({
  data,
  view,
  filters,
  unclassified,
  pickers,
  standIn,
  onOpenTotal,
}: {
  data: ApiAidMoneyLedger
  view: AidView
  filters: LedgerFilters
  unclassified: number | null | undefined
  pickers: ReactNode
  /** The rows are the old filters' (a refiltered read is on its way): opening a total would show the wrong lines. */
  standIn: boolean
  onOpenTotal: (total: ApiAidLedgerTotal) => void
}) {
  const marks = useLedgerNotes((unclassified ?? 0) > 0)
  const filtered = filters.source !== null || filters.program !== null || filters.level !== null
  const foot = footNoteWords(unclassified, filtered)
  const asOf = view.asOf.kind === 'past' ? view.asOf.date : null
  const familiesLine = familiesWords(data.rows.length)
  const lineCount = data.rows.reduce((n, r) => n + r.lines, 0)
  const reversedCount = data.rows.reduce((n, r) => n + r.reversed_lines, 0)
  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidLedgerFamily>> => [
      {
        key: 'family',
        header: 'Family',
        width: 300,
        pinned: true,
        value: (r) => labelWords(labelOfRow(r)),
        title: (r) => labelWords(labelOfRow(r)),
        render: (r) => {
          const link = (
            <Link
              className={CS_LINK_CELL}
              to={aidHref(`/aid/households/${String(r.household_cm_id)}`, view)}
              onClick={(event) => event.stopPropagation()}
            >
              <HouseholdLabelText label={labelOfRow(r)} />
            </Link>
          )
          // §15: a Family Camp household reads ⌂ before its label, as the Requests grid does.
          return isHousehold(r) ? (
            <span className="flex min-w-0 items-center gap-1">
              <Home className="text-muted-foreground h-3 w-3 flex-none" />
              {link}
            </span>
          ) : (
            link
          )
        },
        searchable: true,
      },
      {
        key: 'campers',
        header: 'Campers',
        width: 220,
        value: (r) => campersWords(r),
        title: (r) => campersTitle(r),
        render: (r) =>
          isHousehold(r) ? (
            <span className={r.campers.length === 0 ? 'text-muted-foreground' : undefined}>
              {campersWords(r)}
            </span>
          ) : r.campers.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            r.campers.join(', ')
          ),
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
        mark: marks.camp ?? undefined,
        // The server's season figure for these filters, never a sum of the rows shown (and not the search's).
        total: () => data.in_campminder_net,
        totalTitle: () => totalOpenTitle('in_campminder_net'),
      },
      {
        key: 'outside',
        header: 'Outside grants',
        width: 140,
        align: 'right',
        value: (r) => r.outside_grants,
        render: (r) => <Money value={r.outside_grants} />,
        csv: (r) => moneyCsv(r.outside_grants),
        mark: marks.outside ?? undefined,
        total: () => data.outside_grants,
        totalTitle: () => totalOpenTitle('outside_grants'),
      },
      {
        key: 'lines',
        header: 'Lines',
        width: 120,
        value: (r) => linesWords(r.lines, r.reversed_lines),
        footerNote: () => linesWords(lineCount, reversedCount),
        footerTitle: () => linesWords(lineCount, reversedCount),
      },
      {
        key: 'level',
        header: "Level, where it isn't a request",
        flex: true,
        value: (r) => (r.level === null ? '' : LEDGER_LEVEL_WORDS[r.level]),
        title: (r) => (r.level === null ? undefined : sentenceCase(LEDGER_LEVEL_WORDS[r.level])),
        render: (r) =>
          r.level === null ? (
            ''
          ) : (
            <StatusPill tone={LEDGER_LEVEL_TONE[r.level]}>
              {sentenceCase(LEDGER_LEVEL_WORDS[r.level])}
            </StatusPill>
          ),
        footerNote: () => <span className={`${CS_PMETA} font-normal`}>{foot.words}</span>,
        footerTitle: () => foot.title,
      },
    ],
    [view, marks.camp, marks.outside, data, lineCount, reversedCount, foot.words, foot.title]
  )

  return (
    <AidTable
      rows={data.rows}
      columns={columns}
      rowKey={familyKey}
      searchExtra={searchIds}
      urlPrefix="ledger_"
      csvFilename={ledgerCsvName(data.year, filters, asOf)}
      csvExtra={CSV_EXTRA}
      searchPlaceholder="Family, camper or CM ID"
      searchWidth={220}
      nowrapHeaders
      bounded
      toolbarLead={pickers}
      footerLabel={() => familiesLine}
      footerTitle={() => `${familiesLine}. ${TOTALS_TIP}`}
      footerSpan={2}
      totalsDisabled={standIn}
      onOpenTotal={(key) => {
        const total = TOTAL_OF_COLUMN[key]
        if (total !== undefined) onOpenTotal(total)
      }}
      emptyText="No family has aid lines for these filters."
    />
  )
}
