import { Fragment, useState } from 'react'
import { Link } from 'react-router'

import { useAidHistoryOperation } from '../../../hooks/camperships/useAidHistory'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidHistoryOperation, ApiAidHistoryRow } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  CS_BAND,
  CS_BAND_EDGE,
  CS_LINK,
  CS_LINK_SM,
  CS_PANEL_RULE,
  CS_PILL,
  CS_RULE,
} from '../kit/csType'
import { formatCampDateTime } from '../kit/dates'
import { formatMoney } from '../kit/money'
import {
  actorWords,
  changeItems,
  type ChangeItem,
  compactGroups,
  householdHref,
  KIND_LABELS,
  KIND_TONE,
  openLinks,
  operationWords,
  requestHref,
  rowSession,
  rowView,
  runSummary,
  type CompactGroup,
} from './historyModel'

const FIRST = 8
const ROWS_SHOWN = 25
const BUTTON_LINK = `${CS_LINK_SM} cursor-pointer`
/** cf-pmeta: 12.5/18 muted (the opened row's meta lines). */
const PMETA = 'text-muted-foreground text-[12.5px] leading-[18px]'
/** cf-phead: 11/15 700 uppercase .05em. CS_PANEL_HEAD is the household receipt's sentence-case head, shared by other surfaces. */
const PHEAD =
  'text-muted-foreground text-[11px] leading-[15px] font-bold tracking-[.05em] uppercase'
/** The compact table's cells: the kit's grid at 12.5/18, 3px 8px (hi-open table.cf-grid). */
const COMPACT_TH = `bg-muted text-muted-foreground border-border border-b px-2 py-[3px] text-left text-xs leading-tight font-semibold whitespace-nowrap ${CS_RULE} first:border-l-0`
const COMPACT_TD = `border-border overflow-hidden border-b px-2 py-[3px] align-top text-ellipsis whitespace-nowrap ${CS_RULE} first:border-l-0`
const COMPACT_FOOT = `${CS_BAND} ${CS_BAND_EDGE} px-2 py-[3px] font-bold whitespace-nowrap ${CS_RULE} first:border-l-0`

type SessionNames = ReadonlyMap<number, string> | undefined

function CompactTable({ group }: { group: CompactGroup }) {
  const [all, setAll] = useState(false)
  const rows = all ? group.rows : group.rows.slice(0, FIRST)
  const round = group.rows.some((r) => r.round !== null)
  const foot =
    all || group.rows.length <= FIRST
      ? 'Total, as recorded'
      : `All ${String(group.rows.length)}, as recorded`
  return (
    <div className="flex w-full flex-col items-start gap-0.5">
      <div className="bg-card border-border w-full overflow-hidden rounded-lg border">
        <table
          data-testid="compact-table"
          className="w-full table-fixed border-separate border-spacing-0 text-[12.5px] leading-[18px]"
        >
          <colgroup>
            <col style={{ width: 128 }} />
            <col style={{ width: 150 }} />
            <col />
            {round && <col style={{ width: 56 }} />}
            <col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={COMPACT_TH}>Camper</th>
              <th className={COMPACT_TH}>Household</th>
              <th className={COMPACT_TH}>Session</th>
              {round && <th className={COMPACT_TH}>Round</th>}
              <th className={`${COMPACT_TH} text-right`}>{group.amountLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={COMPACT_TD} title={r.camper}>
                  {r.camperHref === null ? (
                    <span className={r.householdRequest ? 'text-muted-foreground' : ''}>
                      {r.camper}
                    </span>
                  ) : (
                    <Link to={r.camperHref} className={CS_LINK_SM}>
                      {`${r.camper} ›`}
                    </Link>
                  )}
                </td>
                <td className={COMPACT_TD} title={r.household}>
                  {r.householdHref === null ? (
                    r.household
                  ) : (
                    <Link to={r.householdHref} className={CS_LINK_SM}>
                      {`${r.household} ›`}
                    </Link>
                  )}
                </td>
                <td className={COMPACT_TD} title={r.sessionFull === '' ? undefined : r.sessionFull}>
                  {r.session}
                </td>
                {round && <td className={COMPACT_TD}>{r.round ?? ''}</td>}
                <td className={`${COMPACT_TD} text-right tabular-nums`}>{formatMoney(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          {group.total !== null && (
            <tfoot>
              <tr>
                <td colSpan={round ? 4 : 3} className={COMPACT_FOOT}>
                  {foot}
                </td>
                <td className={`${COMPACT_FOOT} text-right tabular-nums`}>
                  {formatMoney(group.total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {group.rows.length > FIRST && (
        <button type="button" className={BUTTON_LINK} onClick={() => setAll(!all)}>
          {all ? 'Show the first 8' : `Show all ${String(group.rows.length)}`}
        </button>
      )}
    </div>
  )
}

/** The mock's change list (.cf-chgl): muted nowrap keys, the old value struck, the new one bold. */
function ChangeList({ items }: { items: readonly ChangeItem[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-px p-0 text-[12.5px] leading-[18px]">
      {items.map((item, i) => (
        <Fragment key={`${String(i)}:${item.label}`}>
          {item.label !== '' && (
            <li className="text-muted-foreground whitespace-nowrap">{item.label}</li>
          )}
          <li className={item.label === '' ? 'col-span-2' : undefined}>
            {item.before !== null && (
              <>
                <s className="text-muted-foreground">{item.before}</s>
                {' → '}
              </>
            )}
            <b className="text-foreground font-bold">{item.after}</b>
          </li>
        </Fragment>
      ))}
    </ul>
  )
}

function RowBlock({
  row,
  view,
  sessions,
}: {
  row: ApiAidHistoryRow
  view: AidView
  sessions: SessionNames
}) {
  const v = rowView(row, sessions)
  const camperHref = requestHref(row, v.householdCmId, view)
  const session = rowSession(row, sessions)
  const items = changeItems(v)
  return (
    <div data-history-row className="flex flex-col items-start gap-0.5">
      {v.camperName !== null && (
        <span className={PMETA}>
          {camperHref === null ? (
            v.camperName
          ) : (
            <Link to={camperHref} className={CS_LINK_SM}>{`${v.camperName} ›`}</Link>
          )}
          {session !== null && ` · ${session}`}
          {v.householdCmId !== null && (
            <>
              {' · '}
              <Link to={householdHref(v.householdCmId, view)} className={CS_LINK_SM}>
                {`${v.householdName ?? ''} ›`}
              </Link>
            </>
          )}
        </span>
      )}
      {v.camperName === null && v.householdCmId !== null && (
        <span className={PMETA}>
          <Link to={householdHref(v.householdCmId, view)} className={CS_LINK_SM}>
            {`${v.householdName ?? ''} ›`}
          </Link>
        </span>
      )}
      {items.length > 0 && <ChangeList items={items} />}
      {v.hidden > 0 && (
        <span
          className={PMETA}
        >{`and ${String(v.hidden)} recorded ${v.hidden === 1 ? 'detail' : 'details'} not listed`}</span>
      )}
    </div>
  )
}

function Blocks({
  rows,
  view,
  sessions,
}: {
  rows: readonly ApiAidHistoryRow[]
  view: AidView
  sessions: SessionNames
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN)
  return (
    <>
      {shown.map((row, i) => (
        <RowBlock
          key={`${row.entity}:${row.entity_id}:${String(i)}`}
          row={row}
          view={view}
          sessions={sessions}
        />
      ))}
      {!all && rows.length > ROWS_SHOWN && (
        <button
          type="button"
          className={BUTTON_LINK}
          onClick={() => setAll(true)}
        >{`Show all ${String(rows.length)} rows`}</button>
      )}
    </>
  )
}

/** A block after the first gets a dotted amber rule above it. */
const BLOCK =
  'border-t border-dotted border-amber-300 pt-2 first:border-t-0 first:pt-0 dark:border-amber-800'

function WhatChanged({ operation, view }: { operation: ApiAidHistoryOperation; view: AidView }) {
  const detail = useAidHistoryOperation(operation.operation_id)
  // A row's session reads by its name ("Session 2"), as the Rules tab's do.
  const sessions = useAidSessionNames(view.year)
  const [theirs, setTheirs] = useState(false)
  if (detail.isLoading) return <p className="text-muted-foreground">Loading its rows…</p>
  if (detail.data === undefined) {
    // A 404 is an answer (not in this season's log): retrying can't change it.
    if (hasStatus(detail.error, 404)) {
      return (
        <p className="text-red-700 dark:text-red-300">
          This operation is not in the log you can read.
        </p>
      )
    }
    return (
      <p className="text-red-700 dark:text-red-300">
        Its rows didn&apos;t load.{' '}
        <button type="button" className={BUTTON_LINK} onClick={() => void detail.refetch()}>
          Try Again
        </button>
      </p>
    )
  }
  const { groups, rest, omitted } = compactGroups(detail.data.rows, view, sessions)
  const intake = operation.kind === 'intake'
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.head} className={BLOCK}>
          <CompactTable group={group} />
        </div>
      ))}
      {omitted > 0 && (
        <div className={PMETA}>
          {`and ${String(omitted)} recorded ${omitted === 1 ? 'row' : 'rows'} not listed: removals that cancel a placement`}
        </div>
      )}
      {intake && rest.length > 0 ? (
        <div className={`${BLOCK} space-y-1`}>
          <div className="font-semibold">Also in this run</div>
          <div className={PMETA}>{runSummary(rest)}</div>
          {theirs ? (
            <>
              <Blocks rows={rest} view={view} sessions={sessions} />
              <button type="button" className={BUTTON_LINK} onClick={() => setTheirs(false)}>
                Hide their rows
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BUTTON_LINK}
              onClick={() => setTheirs(true)}
            >{`Show their ${String(rest.length)} rows`}</button>
          )}
        </div>
      ) : (
        rest.length > 0 && (
          <div className={`${BLOCK} space-y-2`}>
            <Blocks rows={rest} view={view} sessions={sessions} />
          </div>
        )
      )}
    </div>
  )
}

function OpenPanel({ operation, view }: { operation: ApiAidHistoryOperation; view: AidView }) {
  const detail = useAidHistoryOperation(operation.operation_id)
  const links = openLinks(operation, detail.data?.rows ?? [], view)
  return (
    <div className="flex flex-col gap-1">
      {links.households.map((h) => (
        <Link key={h.href} to={h.href} className={CS_LINK}>
          {h.label}
        </Link>
      ))}
      {links.fullList !== null && (
        <Link to={links.fullList.href} className={`${CS_LINK} font-bold`}>
          {links.fullList.label}
        </Link>
      )}
      {links.manyFamilies !== null && <span className={PMETA}>{links.manyFamilies}</span>}
      {links.rules !== null && (
        <Link to={links.rules.href} className={CS_LINK}>
          {links.rules.label}
        </Link>
      )}
      {links.nothing !== null && <span className={PMETA}>{links.nothing}</span>}
    </div>
  )
}

/** The opened row (spec §7.2 D, owner 10-06): why | What changed | Open, split by dashed amber rules, at 13.5/20 (hi-open). */
export function HistoryPanels({
  operation,
  view,
}: {
  operation: ApiAidHistoryOperation
  view: AidView
}) {
  const words = operationWords(operation)
  const PANEL = 'flex min-w-0 flex-col items-start gap-0.5 px-[14px]'
  return (
    <div
      data-testid="history-panels"
      className="grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)_minmax(150px,2.6fr)] text-[13.5px] leading-5"
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5 pr-[14px]">
        {operation.reason === '' ? (
          <span className={PMETA}>No reason recorded.</span>
        ) : (
          <span className="font-semibold">{`“${operation.reason}”`}</span>
        )}
        <span className={PMETA}>
          {`${actorWords(operation.actor)} · ${formatCampDateTime(operation.at)} · `}
          <span className={CS_PILL[KIND_TONE[operation.kind]]}>{KIND_LABELS[operation.kind]}</span>
        </span>
        <span>{words.what}</span>
        <span
          className={PMETA}
          title={`Operation ${operation.operation_id}: search the log by this id`}
        >{`${String(operation.rows)} ${operation.rows === 1 ? 'row' : 'rows'} · id ${operation.operation_id}`}</span>
      </div>
      <div className={`border-l ${PANEL} ${CS_PANEL_RULE}`}>
        <div className={PHEAD}>What changed</div>
        <WhatChanged operation={operation} view={view} />
      </div>
      <div className={`border-l ${PANEL} ${CS_PANEL_RULE}`}>
        <div className={PHEAD}>Open</div>
        <OpenPanel operation={operation} view={view} />
      </div>
    </div>
  )
}
