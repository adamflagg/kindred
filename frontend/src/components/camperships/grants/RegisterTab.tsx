import { Home } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidProgramRank } from '../../../hooks/camperships/useAidProgramNames'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidGrantRow } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidPicker } from '../kit/AidPicker'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { ProgramWordsNote } from '../shell/ProgramWordsNote'
import { CS_BTN, CS_CUT, CS_LINK_CELL, CS_OK_INK, CS_PMETA, CS_TOOLBAR_STATUS } from '../kit/csType'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { CancelMark, StatusPill } from '../kit/Pills'
import type { AidPickerOption } from '../kit/pickerWords'
import { AidSegmented } from '../kit/Segmented'
import { AidToolbar, ToolbarLabel } from '../kit/Toolbar'
import { CommitmentForm } from './CommitmentForm'
import { CommitmentRow } from './CommitmentRow'
import { RegisterOpenRow } from './RegisterOpenRow'
import {
  filterRegister,
  grantorChoices,
  programChoices,
  readRegisterFilters,
  REGISTER_SHOWS,
  registerCsvName,
  showCounts,
  type RegisterShow,
} from './registerFilters'
import {
  basisWords,
  camperTitle,
  camperWords,
  cancelTitle,
  cmWords,
  COMMITTED_CHIP,
  committedTitle,
  countsInTotal,
  footerTitleWords,
  footerWords,
  grantKey,
  needsCamperIds,
  neverAppliedNote,
  neverAppliedShort,
  notCountedWhy,
  offsetTitle,
  offsetWords,
  postedTitle,
  programCsv,
  programWords,
  registerFamily,
  registerTotal,
  standingCsv,
} from './registerModel'

/** Search reaches the household and camper ids and the grant line (§4.3). */
const registerSearch = (row: ApiAidGrantRow) => [
  row.household_cm_id,
  row.person_cm_id > 0 ? row.person_cm_id : null,
  row.transaction_cm_id > 0 ? row.transaction_cm_id : null,
  row.description,
]
const NO_UNMAPPED: ReadonlyArray<{ source_id: string; description: string }> = []
type FilterKey = 'show' | 'grantor' | 'program' | 'row'

/** A figure the total leaves out (★16): grey italic, the reason in the cell's title. */
const OUT = 'text-muted-foreground italic'
/** The picker widths the mock's toolbar gives Grantor and Program (money-grants.html). */
const GRANTOR_WIDTH = 'w-[104px] [&>button]:min-w-0 [&>button]:flex-1'
const PROGRAM_WIDTH = 'w-[92px] [&>button]:min-w-0 [&>button]:flex-1'

/** The Camper cell (money-grants.html): ⊘ first when the camper cancelled, "placed by staff" after the name. */
function CamperCell({
  row,
  needsCamper,
}: {
  row: ApiAidGrantRow
  needsCamper: ReadonlySet<number>
}) {
  if (row.camper_basis === 'household') {
    // §15: a household program's line reads ⌂ and the household's label.
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Home className="text-muted-foreground h-3 w-3 flex-none" />
        <span className={`${CS_CUT} min-w-0`}>
          <HouseholdLabelText label={registerFamily(row)} />
        </span>
      </span>
    )
  }
  if (row.person_cm_id <= 0) {
    const why = basisWords(row, needsCamper)
    return (
      <StatusPill tone="amber" title={`A grant line on no camper${why === '' ? '' : ` · ${why}`}`}>
        Household level
      </StatusPill>
    )
  }
  const basis = basisWords(row, needsCamper)
  return (
    <span className="flex min-w-0 items-baseline">
      {row.cancelled && <CancelMark title={cancelTitle(row)} />}
      <span className={`${CS_CUT} min-w-0`}>
        {row.camper_name}
        {basis !== '' && <span className="text-muted-foreground">{` · ${basis}`}</span>}
      </span>
    </span>
  )
}

/** "Where it stands" (★18): a one-line chip for a commitment, "✓ in CM · Mar 12" for a posted line. */
function StandingCell({ row }: { row: ApiAidGrantRow }) {
  if (row.kind === 'commitment') {
    return (
      <StatusPill tone="amber" title={committedTitle(row)}>
        {COMMITTED_CHIP}
      </StatusPill>
    )
  }
  if (row.is_reversed) return <s className="text-muted-foreground">{cmWords(row)}</s>
  return (
    <>
      <span className={`${CS_OK_INK} mr-1 font-bold`}>✓</span>
      {cmWords(row)}
      {row.fulfils_commitment_id !== '' && (
        <span className="text-muted-foreground"> · fulfils a commitment</span>
      )}
    </>
  )
}

/**
 * Grants › Register (spec §8.2; D55, D126, D142; rulings D, G; money-grants.html, final UX): every
 * outside-grant line in CampMinder this season, plus hand-entered commitments. Filters in the URL
 * (`registerFilters`), a row opened from a link (`?row=`). One toolbar row, one-line rows, the total
 * counts what the server counts (⚠ P-15).
 */
export function RegisterTab({ view }: { view: AidView }) {
  const grants = useAidGrants()
  const rank = useAidProgramRank()
  const defs = useAidDefinitions('grants')
  const { hasPermission } = usePermissions()
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK)
  const [params, setParams] = useSearchParams()
  const filters = readRegisterFilters(params)
  const highlighted = params.get('row')
  const [recording, setRecording] = useState(false)
  // The last write's words, until the next (P-26); another season is another page (#2990 F).
  const [note, setNote] = useState<{ words: string; year: number } | null>(null)
  const shown = note !== null && note.year === view.year ? note : null
  const done = useCallback(
    (words: string) => {
      setRecording(false)
      setNote({ words, year: view.year })
    },
    [view.year]
  )
  const setParam = useCallback(
    (name: FilterKey, value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const onHighlight = useCallback((key: string | null) => setParam('row', key), [setParam])
  // The lines that need a camper, from the same read: the row alone can't say.
  const needsCamper = useMemo(() => needsCamperIds(grants.data?.needs_camper ?? []), [grants.data])
  const unmapped = grants.data?.unmapped ?? NO_UNMAPPED

  // The footnote marks (§12): the registry's notes are numbered Amount, Offsets, Stands, ...; none until it loads.
  const markOf = (key: string) => {
    const n = defs.numberOf(key)
    const title = defs.entries.find((e) => e.key === key)?.text
    return n === null || title === undefined ? undefined : { n, title }
  }
  const amountMark = markOf('register_amount')
  const offsetsMark = markOf('register_offsets')
  const standsMark = markOf('register_stands')

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidGrantRow>> => [
      {
        key: 'camper',
        header: 'Camper',
        width: 196,
        pinned: true,
        value: camperWords,
        title: (r) => camperTitle(r, needsCamper),
        render: (r) => <CamperCell row={r} needsCamper={needsCamper} />,
        searchable: true,
      },
      {
        key: 'family',
        header: 'Family',
        width: 226,
        value: (r) => registerFamily(r).text,
        title: (r) => `${registerFamily(r).text} · open the household`,
        render: (r) => (
          <Link
            className={CS_LINK_CELL}
            to={aidHref(`/aid/households/${String(r.household_cm_id)}`, view)}
          >
            <HouseholdLabelText label={registerFamily(r)} />
          </Link>
        ),
        searchable: true,
      },
      {
        key: 'grantor',
        header: 'Grantor',
        width: 180,
        value: (r) => (r.grantor_key === '' ? 'no grantor yet' : r.grantor_name),
        title: (r) =>
          r.grantor_key === ''
            ? `No grantor yet: "${r.description}" isn't mapped to a funder`
            : `${r.grantor_name} · open in Money › Funders`,
        render: (r) =>
          r.grantor_key === '' ? (
            <span className={CS_PMETA}>no grantor yet</span>
          ) : (
            <Link
              className={CS_LINK_CELL}
              to={aidHref('/aid/money/funders', view, { funder: r.grantor_key })}
            >
              {r.grantor_name}
            </Link>
          ),
        searchable: true,
      },
      {
        key: 'program',
        header: 'Program (in CM)',
        width: 168,
        value: (r) => programCsv(r, needsCamper),
        title: (r) =>
          programWords(r) !== '—'
            ? programWords(r)
            : needsCamper.has(r.transaction_cm_id) && r.kind === 'ledger'
              ? 'Not placed: waiting for its camper'
              : 'Household level',
        render: programWords,
      },
      {
        key: 'offsets',
        header: 'Aid request it offsets',
        width: 176,
        value: (r) => offsetWords(r, needsCamper),
        title: (r) => offsetTitle(r, needsCamper),
        render: (r) =>
          r.counts && r.requests.length > 0 ? (
            offsetWords(r, needsCamper)
          ) : (
            <span className={CS_PMETA}>{offsetWords(r, needsCamper)}</span>
          ),
        mark: offsetsMark,
        // The never-applied note in its own column's footer, beside the total it explains (§10).
        footerNote: (rows) => {
          const words = neverAppliedShort(rows, needsCamper)
          return words === '' ? null : <span className={CS_PMETA}>{words}</span>
        },
        footerTitle: (rows) => neverAppliedNote(rows, needsCamper) || undefined,
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 92,
        align: 'right',
        value: (r) => r.amount,
        title: (r) =>
          countsInTotal(r, needsCamper)
            ? undefined
            : `Not counted: ${notCountedWhy(r, needsCamper)}`,
        render: (r) => {
          const figure = r.is_reversed ? (
            <s>
              <Money value={r.amount} />
            </s>
          ) : (
            <Money value={r.amount} />
          )
          return countsInTotal(r, needsCamper) ? figure : <span className={OUT}>{figure}</span>
        },
        csv: (r) => moneyCsv(r.amount),
        mark: amountMark,
        // ⚠ P-15: only the rows the server counts.
        total: (rows) => registerTotal(rows, needsCamper),
        footerTitle: () => 'The lines the total counts',
      },
      {
        key: 'standing',
        header: 'Where it stands',
        width: 176,
        value: standingCsv,
        title: (r) => (r.kind === 'commitment' ? committedTitle(r) : postedTitle(r)),
        render: (r) => <StandingCell row={r} />,
        mark: standsMark,
      },
    ],
    // The marks are rebuilt each render; their numbers and words are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, needsCamper, amountMark?.n, offsetsMark?.n, standsMark?.n, defs.entries]
  )

  // Cancelled and Counted lost their columns (ruling 15, ★16); the file keeps both facts.
  const csvExtra = useMemo(
    (): ReadonlyArray<AidCsvExtra<ApiAidGrantRow>> => [
      { header: 'Household CM id', value: (r) => String(r.household_cm_id) },
      { header: 'Cancelled', value: (r) => (r.cancelled ? 'cancelled' : '') },
      {
        header: 'Counted',
        value: (r) => (countsInTotal(r, needsCamper) ? 'counted' : 'not counted'),
      },
    ],
    [needsCamper]
  )

  // Keyed by row: a form's typing belongs to its row, and a refetch never resets it.
  const renderDetail = useCallback(
    (row: ApiAidGrantRow) =>
      row.kind === 'commitment' && canWork ? (
        <CommitmentRow
          key={grantKey(row)}
          row={row}
          year={view.year}
          view={view}
          needsCamper={needsCamper}
          onDone={done}
        />
      ) : (
        <RegisterOpenRow
          key={grantKey(row)}
          row={row}
          view={view}
          needsCamper={needsCamper}
          unmapped={unmapped}
        />
      ),
    [view, needsCamper, canWork, done, unmapped]
  )

  return (
    <QueryGuard
      isLoading={grants.isLoading}
      error={grants.data ? null : grants.error}
      data={grants.data}
      label="Grants"
    >
      {(data) => {
        const rows = filterRegister(data.grants, filters, needsCamper)
        const counts = showCounts(data.grants, filters, needsCamper)
        const grantorOptions: Array<AidPickerOption<string>> = [
          { value: '', label: 'All' },
          ...grantorChoices(data.grants),
        ]
        const programOptions: Array<AidPickerOption<string>> = [
          { value: '', label: 'All' },
          ...programChoices(data.grants, rank),
        ]
        const pickers = (
          <>
            <ToolbarLabel text="Grantor" plain>
              <AidPicker
                label="Grantor"
                value={filters.grantor ?? ''}
                options={grantorOptions}
                onChange={(next) => setParam('grantor', next === '' ? null : next)}
                className={GRANTOR_WIDTH}
              />
            </ToolbarLabel>
            <ToolbarLabel text="Program (in CM)" plain>
              <AidPicker
                label="Program (in CM)"
                value={filters.program ?? ''}
                options={programOptions}
                onChange={(next) => setParam('program', next === '' ? null : next)}
                className={PROGRAM_WIDTH}
              />
            </ToolbarLabel>
          </>
        )
        return (
          <div className="space-y-2">
            {/* §18: one flat list with one choice on is the grey switcher, counts inside; it keeps its own row. */}
            <AidToolbar
              left={
                <AidSegmented<RegisterShow>
                  label="Show"
                  value={filters.show}
                  options={REGISTER_SHOWS.map((s) => ({
                    value: s.value,
                    label: s.label,
                    count: counts[s.value],
                    title: s.title,
                  }))}
                  onChange={(value) => setParam('show', value === 'all' ? null : value)}
                />
              }
            />
            <AidTable
              rows={rows}
              columns={columns}
              rowKey={grantKey}
              searchExtra={registerSearch}
              csvFilename={registerCsvName(data.year, filters)}
              csvExtra={csvExtra}
              highlighted={highlighted}
              onHighlight={onHighlight}
              nowrapHeaders
              belowToolbar={
                recording ? (
                  <CommitmentForm
                    year={data.year}
                    onCancel={() => setRecording(false)}
                    onDone={done}
                  />
                ) : undefined
              }
              toolbarLead={pickers}
              searchWidth={190}
              toolbarStatus={
                shown === null ? undefined : (
                  <span className={CS_TOOLBAR_STATUS} title={shown.words}>
                    ✓ {shown.words}
                  </span>
                )
              }
              toolbarActions={
                canWork ? (
                  <button
                    type="button"
                    className={CS_BTN}
                    disabled={recording}
                    title={recording ? 'The form is open below' : undefined}
                    onClick={() => setRecording(true)}
                  >
                    Record a Commitment…
                  </button>
                ) : undefined
              }
              // The label spans Camper and Family and cuts off with a title (money-grants.html).
              footerSpan={2}
              footerLabel={(shownRows) => {
                const [count = '', notCounted] = footerWords(shownRows, needsCamper).split(' · ')
                return (
                  <>
                    {count}
                    {notCounted !== undefined && (
                      <span className="text-muted-foreground font-normal">{` · ${notCounted}`}</span>
                    )}
                  </>
                )
              }}
              footerTitle={(shownRows) => footerTitleWords(shownRows, needsCamper)}
              renderDetail={renderDetail}
              searchPlaceholder="Camper, family, grantor"
              arrowKeys
              emptyText="No grants match."
            />
            <ProgramWordsNote />
          </div>
        )
      }}
    </QueryGuard>
  )
}
