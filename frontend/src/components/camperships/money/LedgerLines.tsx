import { useMemo } from 'react'
import { Link } from 'react-router'

import { useAidLedgerLines } from '../../../hooks/camperships/useAidMoneyLedger'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import type {
  ApiAidLedgerFamily,
  ApiAidLedgerLine,
  ApiAidLedgerTotal,
} from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { CS_BTN2, CS_CARD, CS_LABEL, CS_LINK } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney, moneyCsv } from '../kit/money'
import { Money, ReversedAmount } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { programLabel } from '../requests/programLabel'
import {
  LEDGER_LEVEL_TONE,
  LEDGER_LEVEL_WORDS,
  LEDGER_TOTAL_WORDS,
  ledgerLinesCsvName,
  type LedgerFilters,
} from './ledgerFamiliesModel'
import { keyWords } from './sourcesModel'

const lineKey = (line: ApiAidLedgerLine) => String(line.transaction_cm_id)
/** ", 1 reversed (struck, not counted)": the amount adds live lines only (`lines()`, R3-14). */
const reversedWords = (n: number) =>
  n === 0 ? '' : `, ${String(n)} reversed (struck, not counted)`

/**
 * The CampMinder lines behind one of the Ledger's totals (owner ruling F; money-v2.html "each total
 * opens its lines"), read with the family read's own filters and day. The heading states the
 * read's `amount`, the total these lines make; a reversed line shows struck (D74) and is left out
 * of it. "Download CSV" carries exactly these lines.
 */
export function LedgerLines({
  total,
  filters,
  view,
  familyOf,
  onClose,
}: {
  total: ApiAidLedgerTotal
  filters: LedgerFilters
  view: AidView
  /** The family row a line belongs to, by `family_household_cm_id` (R3-3: the label's join). */
  familyOf: (familyHouseholdCmId: number) => ApiAidLedgerFamily | undefined
  onClose: () => void
}) {
  const lines = useAidLedgerLines(total, filters)
  const names = useAidProgramNames()
  const columns = useMemo((): ReadonlyArray<AidColumn<ApiAidLedgerLine>> => {
    // Ruling D on the lines card too (R3-3): the family row's label, else the line's family name.
    const labelOfLine = (l: ApiAidLedgerLine) =>
      familyLabel(familyOf(l.family_household_cm_id) ?? {}, l.family_name)
    return [
      {
        key: 'family',
        header: 'Family',
        width: 200,
        pinned: true,
        value: (l) => labelWords(labelOfLine(l)),
        render: (l) => (
          // R3-14: the family's household, the one the name and the family row are.
          <Link
            className={CS_LINK}
            to={aidHref(`/aid/households/${String(l.family_household_cm_id)}`, view)}
            onClick={(event) => event.stopPropagation()}
          >
            <HouseholdLabelText label={labelOfLine(l)} />
          </Link>
        ),
        searchable: true,
      },
      { key: 'camper', header: 'Camper', width: 150, value: (l) => l.camper, searchable: true },
      {
        key: 'description',
        header: 'Description in CampMinder',
        width: 220,
        value: (l) => l.description,
        searchable: true,
      },
      {
        key: 'source',
        header: 'Source family',
        width: 140,
        value: (l) => keyWords(l.source_family),
      },
      {
        key: 'program',
        header: 'Program',
        width: 140,
        value: (l) => (l.program === '' ? '' : programLabel(names, l.program)),
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 170,
        align: 'right',
        value: (l) => l.amount,
        render: (l) =>
          l.is_reversed && l.reversed_on !== null ? (
            <ReversedAmount value={l.amount} reversedOn={l.reversed_on} />
          ) : (
            <Money value={l.amount} />
          ),
        csv: (l) => moneyCsv(l.amount),
      },
      {
        key: 'posted',
        header: 'Posted on',
        width: 100,
        value: (l) => l.posted_on ?? '',
        render: (l) => (l.posted_on === null ? '' : formatShortDate(l.posted_on)),
      },
      {
        key: 'level',
        header: "Level, where it isn't a request",
        flex: true,
        value: (l) => (l.level === null ? '' : LEDGER_LEVEL_WORDS[l.level]),
        render: (l) =>
          l.level === null ? (
            ''
          ) : (
            <StatusPill tone={LEDGER_LEVEL_TONE[l.level]}>{LEDGER_LEVEL_WORDS[l.level]}</StatusPill>
          ),
      },
    ]
  }, [names, view, familyOf])
  const asOf = view.asOf.kind === 'past' ? view.asOf.date : null

  return (
    <section className={`${CS_CARD} space-y-2 p-3`} data-testid="ledger-lines">
      <QueryGuard
        isLoading={lines.isLoading}
        // Owner ruling Group 5: a failed background refetch keeps what loaded.
        error={lines.data ? null : lines.error}
        data={lines.data}
        label="the lines behind the total"
      >
        {(data) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={CS_LABEL}>
                {`${LEDGER_TOTAL_WORDS[data.total]} ${formatMoney(data.amount)} · the ${String(data.lines.length)} ${data.lines.length === 1 ? 'line' : 'lines'} behind it`}
                {/* R3-14: the amount counts live lines only; say how many reversed ones it leaves out. */}
                {reversedWords(data.lines.filter((l) => l.is_reversed).length)}
              </p>
              <button type="button" className={CS_BTN2} onClick={onClose}>
                Close
              </button>
            </div>
            <AidTable
              rows={data.lines}
              columns={columns}
              rowKey={lineKey}
              urlPrefix="lines_"
              csvFilename={ledgerLinesCsvName(view.year, total, filters, asOf)}
              emptyText="No lines make this total."
            />
          </>
        )}
      </QueryGuard>
    </section>
  )
}
