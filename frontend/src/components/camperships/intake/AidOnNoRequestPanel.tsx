import { useCallback, useContext, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { QueryGuard } from '../../QueryGuard'
import { Permission } from '../../../constants/permissions'
import { useAidAidOnNoRequest, useAidIntakeForms } from '../../../hooks/camperships/useAidIntake'
import { usePermissions } from '../../../hooks/usePermissions'
import { useYear } from '../../../hooks/useCurrentYear'
import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { AidTable, type AidColumn } from '../kit/AidTable'
import type { AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { AidHouseholdChip, AidNameWithChip } from '../kit/NameChips'
import { aidActionColumn } from '../kit/RowAction'
import { SeasonStatusContext } from '../season/seasonStatus'
import { AddRequestEditor } from './AddRequestEditor'
import {
  fullName,
  householdHref,
  linesInPool,
  sessionIndex,
  shortName,
  targetFromLine,
  type SessionIndex,
} from './intakeModel'
import type { AidOnNoRequestLineOut, AidOnNoRequestResponse, FormIntakeRowOut } from './intakeTypes'

const AMBER = POOL_NEGATIVE_INK
const LIVE = { kind: 'live' } as const
const lineKey = (line: AidOnNoRequestLineOut) => `${line.row_key}:${String(line.session_cm_id)}`
const sumOf = (lines: readonly AidOnNoRequestLineOut[]) =>
  lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0) / 100

function footer(lines: readonly AidOnNoRequestLineOut[]): string {
  const families = new Set(lines.map((l) => l.household_cm_id)).size
  return `${String(families)} ${families === 1 ? 'family' : 'families'} · ${String(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}`
}

function FamilyCell({ line, view }: { line: AidOnNoRequestLineOut; view: AidView }) {
  const href = line.household_cm_id > 0 ? householdHref(view, line.household_cm_id) : null
  if (line.person_cm_id === 0)
    return href === null ? (
      <span>⌂ {line.household_label}</span>
    ) : (
      <Link to={href} className={CS_LINK_CELL}>
        ⌂ {line.household_label}
      </Link>
    )
  return (
    <AidNameWithChip
      name={
        href === null ? (
          <span>{line.camper_name}</span>
        ) : (
          <Link to={href} className={CS_LINK_CELL}>
            {line.camper_name}
          </Link>
        )
      }
      chip={
        <AidHouseholdChip
          label={href === null ? undefined : line.household_label}
          href={href}
          title={href === null ? undefined : `Open the ${line.household_label ?? ''} household`}
        />
      }
    />
  )
}

function Lines({
  read,
  rows,
  view,
  pool,
}: {
  read: AidOnNoRequestResponse
  rows: ReadonlyMap<string, FormIntakeRowOut>
  view: AidView
  pool: string | null
}) {
  const { hasPermission } = usePermissions()
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK)
  const say = useContext(SeasonStatusContext)
  const names: SessionIndex = useMemo(() => sessionIndex(read.sessions), [read.sessions])
  const [adding, setAdding] = useState<string | null>(null)
  const shown = useMemo(() => linesInPool(read.lines, pool), [read.lines, pool])

  const columns = useMemo((): Array<AidColumn<AidOnNoRequestLineOut>> => {
    const cols: Array<AidColumn<AidOnNoRequestLineOut>> = [
      {
        key: 'family',
        header: 'Family',
        width: 300,
        value: (l) => (l.person_cm_id === 0 ? (l.household_label ?? '') : (l.camper_name ?? '')),
        title: (l) =>
          l.person_cm_id === 0
            ? `Household request: ${l.household_label ?? ''}`
            : `${l.camper_name ?? ''} · household ${l.household_label ?? ''}`,
        render: (l) => <FamilyCell line={l} view={view} />,
      },
      {
        key: 'session',
        header: 'Session the posting suggests',
        width: 210,
        help: "CampMinder posted the aid on this session (or Go's attribution inferred it). Add a Request… starts there; the picker offers the family's other enrolled sessions with no request.",
        value: (l) => (l.session_cm_id > 0 ? shortName(l.session_cm_id, names) : 'unclear'),
        title: (l) =>
          l.session_cm_id > 0
            ? fullName(l.session_cm_id, names)
            : 'CampMinder names no session the dashboard can tell',
      },
      {
        key: 'posted',
        header: 'Posted',
        width: 80,
        value: (l) => (l.posted_on ? formatShortDate(l.posted_on) : null),
      },
      {
        key: 'amount',
        header: 'CampMinder aid',
        width: 120,
        align: 'right',
        value: (l) => l.amount,
        title: (l) =>
          `CampMinder posted ${formatMoney(l.amount)} of camp aid on this family, and no request holds it. Shown, never counted.`,
        render: (l) => <Money value={l.amount} className={AMBER} />,
        total: (list) => sumOf(list),
        totalClassName: AMBER,
      },
    ]
    if (canWork)
      cols.push(
        aidActionColumn<AidOnNoRequestLineOut>({
          width: 132,
          action: (l) =>
            l.can_add
              ? {
                  label: 'Add a Request…',
                  title: `Add a request for ${l.person_cm_id === 0 ? (l.household_label ?? '') : (l.camper_name ?? '')}`,
                  onClick: () => setAdding(lineKey(l)),
                }
              : null,
        })
      )
    return cols
  }, [names, view, canWork])

  const renderDetail = useCallback(
    (l: AidOnNoRequestLineOut) => (
      <AddRequestEditor
        // The Form intake row brings the registration ask; a late read starts the editor over with it.
        key={`${lineKey(l)}:${rows.has(l.row_key) ? 'row' : 'line'}`}
        target={targetFromLine(l, rows.get(l.row_key))}
        names={names}
        onSaved={(words) => {
          setAdding(null)
          say(words)
        }}
        onCancel={() => setAdding(null)}
      />
    ),
    [rows, names, say]
  )

  return (
    <AidTable<AidOnNoRequestLineOut>
      rows={shown}
      columns={columns}
      rowKey={lineKey}
      csvFilename={`camperships-campminder-aid-on-no-request-${String(read.year)}.csv`}
      hideToolbar
      nowrapHeaders
      sortable={false}
      // Only Add a Request… opens a line: a click elsewhere on a row keeps it shut, as the mock draws it.
      highlighted={adding}
      onHighlight={(key) => {
        if (key === null) setAdding(null)
      }}
      renderDetail={canWork ? renderDetail : undefined}
      footerSpan={3}
      footerLabel={footer}
      footerTitle={footer}
      emptyText="Nothing left on this line: every family it counted now has a request."
    />
  )
}

/**
 * Season › Rounds & budget's "CampMinder aid on no request" opened in place (owner Q4-A; design rule 23): one line per
 * camper (or household) × session, each with Add a Request… opening its editor right there (Q5-A's Round 1 offered,
 * ticked, when the money is that camper's). The Form intake read gives each line its registration ask and held
 * sessions. `pool` is Season's `?pool=` (null: every pool): the lines, footer and total are that scope's.
 */
export function AidOnNoRequestPanel({ pool }: { readonly pool: string | null }) {
  const year = useYear()
  const view = useMemo((): AidView => ({ year, asOf: LIVE }), [year])
  const read = useAidAidOnNoRequest(true)
  const forms = useAidIntakeForms()
  const rows = useMemo(
    () => new Map((forms.data?.rows ?? []).map((r) => [r.key, r] as const)),
    [forms.data]
  )
  return (
    <div data-testid="aid-on-no-request" className="py-1">
      <QueryGuard
        isLoading={read.isLoading}
        error={read.data ? null : read.error}
        data={read.data}
        label="CampMinder aid on no request"
      >
        {(data) => <Lines read={data} rows={rows} view={view} pool={pool} />}
      </QueryGuard>
    </div>
  )
}
