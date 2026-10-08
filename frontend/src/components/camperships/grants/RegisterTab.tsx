import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidGrantRow } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import {
  CS_BTN,
  CS_CHIP,
  CS_CHIP_COUNT,
  CS_CHIP_INK,
  CS_CHIP_ON,
  CS_FLABEL,
  CS_LINK,
  CS_PMETA,
  CS_SELECT,
  CS_SMALL,
  CS_STRIP,
  CS_STRIP_LENSES,
} from '../kit/csType'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { sentenceCase } from '../kit/words'
import { DONE_NOTE, MARK_TEXT } from '../money/toPlaceStyles'
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
  camperWords,
  countsInTotal,
  programWords,
  registerTotal,
  footerWords,
  grantKey,
  needsCamperIds,
  offsetWords,
  REGISTER_TOTAL_NOTE,
  registerFamily,
  standingCsv,
  standingNote,
  standingWords,
} from './registerModel'

/** Search reaches the household and camper ids and the grant line (§4.3). */
const registerSearch = (row: ApiAidGrantRow) => [
  row.household_cm_id,
  row.person_cm_id > 0 ? row.person_cm_id : null,
  row.transaction_cm_id > 0 ? row.transaction_cm_id : null,
  row.description,
]
const REGISTER_CSV_EXTRA: ReadonlyArray<AidCsvExtra<ApiAidGrantRow>> = [
  { header: 'Household id', value: (r) => String(r.household_cm_id) },
]
const NO_UNMAPPED: ReadonlyArray<{ source_id: string; description: string }> = []
type FilterKey = 'show' | 'grantor' | 'program' | 'row'

/**
 * Grants › Register (spec §8.2; D55, D126, D142; rulings D, G; grants-v2.html): every outside-grant
 * line in CampMinder this season, plus hand-entered commitments. Filters in the URL
 * (`registerFilters`), a row opened from a link (`?row=`). The total counts what the server counts
 * (⚠ P-15).
 */
export function RegisterTab({ view }: { view: AidView }) {
  const grants = useAidGrants()
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

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidGrantRow>> => [
      {
        key: 'camper',
        header: 'Camper',
        width: 150,
        pinned: true,
        value: camperWords,
        render: (r) => (
          <div>
            {r.person_cm_id > 0 || r.camper_basis === 'household' ? (
              camperWords(r)
            ) : (
              <StatusPill tone="amber">Household level</StatusPill>
            )}
            {basisWords(r, needsCamper) !== '' && (
              <div className={CS_PMETA}>{basisWords(r, needsCamper)}</div>
            )}
          </div>
        ),
        searchable: true,
      },
      {
        key: 'family',
        header: 'Family',
        width: 130,
        value: (r) => registerFamily(r).text,
        render: (r) => (
          <Link
            className={CS_LINK}
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
        width: 140,
        value: (r) => (r.grantor_key === '' ? 'no grantor yet' : r.grantor_name),
        render: (r) =>
          r.grantor_key === '' ? (
            <span className={CS_PMETA}>no grantor yet</span>
          ) : (
            <Link
              className={CS_LINK}
              to={aidHref('/aid/money/funders', view, { funder: r.grantor_key })}
            >
              {r.grantor_name}
            </Link>
          ),
        searchable: true,
      },
      {
        key: 'program',
        header: 'Program',
        width: 110,
        value: (r) => programWords(r, needsCamper),
      },
      {
        key: 'offsets',
        header: 'Aid request it offsets',
        width: 164,
        value: (r) => offsetWords(r, needsCamper),
        render: (r) =>
          r.counts && r.requests.length > 0 ? (
            offsetWords(r, needsCamper)
          ) : (
            <span className={CS_PMETA}>{offsetWords(r, needsCamper)}</span>
          ),
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 90,
        align: 'right',
        value: (r) => r.amount,
        render: (r) =>
          r.is_reversed ? (
            <s>
              <Money value={r.amount} />
            </s>
          ) : (
            <Money value={r.amount} />
          ),
        csv: (r) => moneyCsv(r.amount),
        // ⚠ P-15: only the rows the server counts.
        total: (rows) => registerTotal(rows, needsCamper),
      },
      {
        key: 'standing',
        header: 'Where it stands',
        // Room for the whole "Committed · not yet in CampMinder" pill: 210 clipped it.
        width: 230,
        value: standingCsv,
        render: (r) =>
          r.kind === 'commitment' ? (
            <div>
              <StatusPill tone="amber">{sentenceCase(standingWords(r))}</StatusPill>
              <div className={CS_PMETA}>{standingNote(r)}</div>
            </div>
          ) : r.is_reversed ? (
            <s className={CS_PMETA}>{standingWords(r)}</s>
          ) : (
            <div>
              <span className={MARK_TEXT}>{`✓ ${standingWords(r)}`}</span>
              {standingNote(r) !== '' && <div className={CS_PMETA}>{standingNote(r)}</div>}
            </div>
          ),
      },
      {
        key: 'cancelled',
        header: 'Cancelled',
        width: 90,
        value: (r) => (r.cancelled ? 'cancelled' : ''),
        render: (r) => (r.cancelled ? <StatusPill tone="stone">Cancelled</StatusPill> : ''),
      },
      {
        key: 'counted',
        header: 'Counted',
        width: 110,
        value: (r) => (countsInTotal(r, needsCamper) ? 'counted' : 'not counted'),
        render: (r) =>
          countsInTotal(r, needsCamper) ? '' : <StatusPill tone="muted">Not counted</StatusPill>,
      },
    ],
    [view, needsCamper]
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
        const chip = (value: RegisterShow, label: string) => {
          const on = filters.show === value
          return (
            <button
              key={value}
              type="button"
              className={on ? CS_CHIP_ON : value === 'all' ? CS_CHIP_INK : CS_CHIP}
              onClick={() => setParam('show', value === 'all' || on ? null : value)}
            >
              {label} <span className={CS_CHIP_COUNT}>{counts[value]}</span>
            </button>
          )
        }
        const [all, ...rest] = REGISTER_SHOWS
        return (
          <div className="space-y-3">
            {shown !== null && <p className={DONE_NOTE}>✓ {shown.words}</p>}
            <div className={CS_STRIP} data-testid="register-chips">
              {all !== undefined && (
                <div className={CS_STRIP_LENSES}>{chip(all.value, all.label)}</div>
              )}
              <div className="flex min-w-0 gap-0.5 overflow-x-auto">
                {rest.map((s) => chip(s.value, s.label))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className={`${CS_FLABEL} inline-flex items-center gap-2`}>
                <span>Grantor</span>
                <select
                  aria-label="Grantor"
                  className={CS_SELECT}
                  value={filters.grantor ?? ''}
                  onChange={(event) => setParam('grantor', event.target.value || null)}
                >
                  <option value="">All</option>
                  {grantorChoices(data.grants).map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${CS_FLABEL} inline-flex items-center gap-2`}>
                <span>Program</span>
                <select
                  aria-label="Program"
                  className={CS_SELECT}
                  value={filters.program ?? ''}
                  onChange={(event) => setParam('program', event.target.value || null)}
                >
                  <option value="">All</option>
                  {programChoices(data.grants).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {canWork && !recording && (
                <button
                  type="button"
                  className={`${CS_BTN} ml-auto`}
                  onClick={() => setRecording(true)}
                >
                  Record a Commitment…
                </button>
              )}
            </div>
            {recording && (
              <CommitmentForm year={data.year} onCancel={() => setRecording(false)} onDone={done} />
            )}
            <AidTable
              rows={rows}
              columns={columns}
              rowKey={grantKey}
              searchExtra={registerSearch}
              csvFilename={registerCsvName(data.year, filters)}
              csvExtra={REGISTER_CSV_EXTRA}
              highlighted={highlighted}
              onHighlight={onHighlight}
              footerLabel={(shownRows) => footerWords(shownRows, needsCamper)}
              renderDetail={renderDetail}
              searchPlaceholder="Camper, family, grantor"
              arrowKeys
              emptyText="No grants match."
            />
            <p className={CS_SMALL}>{REGISTER_TOTAL_NOTE}</p>
          </div>
        )
      }}
    </QueryGuard>
  )
}
