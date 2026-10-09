import { Home } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { useAidLedgerLines } from '../../../hooks/camperships/useAidMoneyLedger'
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
import { CS_BTN2, CS_LINK_CELL, CS_PMETA } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { familyLabel } from '../kit/familyLabel'
import { moneyCsv } from '../kit/money'
import { Money, ReversedAmount } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { AidToolbar } from '../kit/Toolbar'
import { sentenceCase } from '../kit/words'
import {
  LEDGER_LEVEL_TONE,
  LEDGER_LEVEL_WORDS,
  householdSessionTiny,
  ledgerLinesCsvName,
  linesHeading,
  type LedgerFilters,
} from './ledgerFamiliesModel'
import { summaryProgramWords } from './ledgerModel'
import { familyWordsOf } from './sourcesModel'

const lineKey = (line: ApiAidLedgerLine) => String(line.transaction_cm_id)
const NO_CAMPER_TITLE = 'Posted to the household: no camper on the line'
const LEVEL_HELP =
  "Level, where it isn't a request: why the money sits on the household, not on a request"

/**
 * The CampMinder lines behind one of the Ledger's totals (owner ruling F; ★13), read with the family
 * read's own filters and day. One heading row (the table's toolbar): the read's `amount`, the total
 * these lines make, then the line count; then search, Download CSV and Close. A reversed line shows
 * struck (D74) and is left out of the amount. "Download CSV" carries exactly these lines.
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
  const columns = useMemo((): ReadonlyArray<AidColumn<ApiAidLedgerLine>> => {
    // Ruling D on the lines card too (R3-3): the family row's label, else the line's family name.
    const labelOfLine = (l: ApiAidLedgerLine) =>
      familyLabel(familyOf(l.family_household_cm_id) ?? {}, l.family_name)
    return [
      {
        key: 'family',
        header: 'Family',
        width: 170,
        pinned: true,
        value: (l) => labelWords(labelOfLine(l)),
        title: (l) => labelWords(labelOfLine(l)),
        render: (l) => {
          // R3-14: the family's household, the one the name and the family row are.
          const link = (
            <Link
              className={CS_LINK_CELL}
              to={aidHref(`/aid/households/${String(l.family_household_cm_id)}`, view)}
              onClick={(event) => event.stopPropagation()}
            >
              <HouseholdLabelText label={labelOfLine(l)} />
            </Link>
          )
          // §15: a line posted to a Family Camp household reads ⌂ before its family label.
          return l.household_session != null ? (
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
        key: 'camper',
        header: 'Camper',
        width: 140,
        value: (l) =>
          l.camper === '' && l.household_session != null
            ? householdSessionTiny(l.household_session)
            : l.camper,
        title: (l) =>
          l.camper !== ''
            ? l.camper
            : l.household_session != null
              ? `Posted to the household: ${l.household_session.name}`
              : NO_CAMPER_TITLE,
        // A line posted to the household names no camper: ⌂ and its session, muted, on a Family Camp
        // household request (mock lines card); otherwise a muted "—".
        render: (l) =>
          l.camper !== '' ? (
            l.camper
          ) : l.household_session != null ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Home className="inline-block h-3 w-3" />
              {householdSessionTiny(l.household_session)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        searchable: true,
      },
      {
        key: 'description',
        header: 'Description in CampMinder',
        width: 190,
        value: (l) => l.description,
        title: (l) => l.description,
        searchable: true,
      },
      {
        key: 'source',
        header: 'Source family',
        width: 150,
        value: (l) => familyWordsOf(l),
        title: (l) => familyWordsOf(l),
      },
      {
        key: 'program',
        header: 'Program',
        width: 100,
        value: (l) => (l.program === '' ? '' : summaryProgramWords(l.program, l.program_label)),
        title: (l) =>
          l.program === ''
            ? "No program: the money isn't on a request"
            : summaryProgramWords(l.program, l.program_label),
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 130,
        align: 'right',
        value: (l) => l.amount,
        title: (l) =>
          l.is_reversed && l.reversed_on !== null
            ? `Reversed ${formatShortDate(l.reversed_on)}: struck, not counted`
            : undefined,
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
        width: 76,
        value: (l) => l.posted_on ?? '',
        render: (l) => (l.posted_on === null ? '' : formatShortDate(l.posted_on)),
      },
      {
        key: 'level',
        header: "Level, where it isn't a request",
        flex: true,
        help: LEVEL_HELP,
        value: (l) => (l.level === null ? '' : LEDGER_LEVEL_WORDS[l.level]),
        title: (l) => (l.level === null ? undefined : sentenceCase(LEDGER_LEVEL_WORDS[l.level])),
        render: (l) =>
          l.level === null ? (
            ''
          ) : (
            <StatusPill tone={LEDGER_LEVEL_TONE[l.level]}>
              {sentenceCase(LEDGER_LEVEL_WORDS[l.level])}
            </StatusPill>
          ),
      },
    ]
  }, [view, familyOf])
  const asOf = view.asOf.kind === 'past' ? view.asOf.date : null
  const close = (
    <button type="button" className={CS_BTN2} onClick={onClose}>
      Close
    </button>
  )

  return (
    <section className="space-y-2 pt-2" data-testid="ledger-lines">
      {/* Loading or failed: the heading row's Close alone, so a stuck read never pins the card open. */}
      {lines.data === undefined && <AidToolbar right={close} />}
      <QueryGuard
        isLoading={lines.isLoading}
        // Owner ruling Group 5: a failed background refetch keeps what loaded.
        error={lines.data ? null : lines.error}
        data={lines.data}
        label="the lines behind the total"
      >
        {(data) => {
          const heading = linesHeading(
            data.total,
            data.amount,
            data.lines.length,
            data.lines.filter((l) => l.is_reversed).length
          )
          return (
            <AidTable
              rows={data.lines}
              columns={columns}
              rowKey={lineKey}
              urlPrefix="lines_"
              csvFilename={ledgerLinesCsvName(view.year, total, filters, asOf)}
              searchPlaceholder="Names or CM IDs"
              searchWidth={180}
              nowrapHeaders
              bounded
              toolbarLead={
                <span className="flex min-w-0 items-baseline gap-2 truncate">
                  <b className="flex-none text-[13.5px]" title={heading.title}>
                    {heading.title}
                  </b>
                  <span className={`${CS_PMETA} min-w-0 truncate`} title={heading.desc}>
                    {heading.desc}
                  </span>
                </span>
              }
              toolbarEnd={close}
              emptyText="No lines make this total."
            />
          )
        }}
      </QueryGuard>
    </section>
  )
}
