import { useState } from 'react'
import { Link } from 'react-router'

import { useAidHistoryOperation } from '../../../hooks/camperships/useAidHistory'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidHistoryOperation, ApiAidHistoryRow } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  CS_LINK,
  CS_PANEL,
  CS_PANEL_HEAD,
  CS_PANEL_RULE,
  CS_PILL,
  CS_PMETA,
  CS_SMALL,
} from '../kit/csType'
import { formatCampDateTime } from '../kit/dates'
import { formatMoney } from '../kit/money'
import {
  actorWords,
  compactGroups,
  householdHref,
  KIND_LABELS,
  KIND_TONE,
  openLinks,
  operationWords,
  requestHref,
  rowView,
  runSummary,
  type CompactGroup,
} from './historyModel'

const FIRST = 8
const ROWS_SHOWN = 25
const BUTTON_LINK = `${CS_LINK} cursor-pointer`
const COMPACT_TH = 'border-b border-amber-200/70 px-1.5 py-1 dark:border-amber-900/50'
const COMPACT_FOOT = 'border-t border-amber-200/70 px-1.5 py-0.5 dark:border-amber-900/50'

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
    <div className="space-y-1">
      <div className="font-semibold">{group.head}</div>
      <table data-testid="compact-table" className={`${CS_PANEL} w-full border-collapse`}>
        <thead>
          <tr className={`${CS_PMETA} font-semibold`}>
            <th className={`${COMPACT_TH} text-left`}>Camper</th>
            <th className={`${COMPACT_TH} text-left`}>Household</th>
            <th className={`${COMPACT_TH} text-left`}>Session</th>
            {round && <th className={`${COMPACT_TH} text-left`}>Round</th>}
            <th className={`${COMPACT_TH} text-right`}>{group.amountLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-1.5 py-0.5">
                {r.camperHref === null ? (
                  r.camper
                ) : (
                  <Link to={r.camperHref} className={CS_LINK}>
                    {r.camper}
                  </Link>
                )}
              </td>
              <td className="px-1.5 py-0.5">
                {r.householdHref === null ? (
                  r.household
                ) : (
                  <Link to={r.householdHref} className={CS_LINK}>
                    {r.household}
                  </Link>
                )}
              </td>
              <td className="px-1.5 py-0.5">{r.session}</td>
              {round && <td className="px-1.5 py-0.5">{r.round ?? ''}</td>}
              <td className="px-1.5 py-0.5 text-right tabular-nums">{formatMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        {group.total !== null && (
          <tfoot>
            <tr className="font-semibold">
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
      {group.rows.length > FIRST && (
        <button type="button" className={BUTTON_LINK} onClick={() => setAll(!all)}>
          {all ? 'Show the first 8' : `Show all ${String(group.rows.length)}`}
        </button>
      )}
    </div>
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
  return (
    <div data-history-row className="space-y-0.5">
      <div>
        <span className="font-semibold">{v.head}</span>
        {(v.camperName !== null || v.householdCmId !== null) && (
          <span className="text-muted-foreground">
            {v.camperName !== null && (
              <>
                {' · '}
                {camperHref === null ? (
                  v.camperName
                ) : (
                  <Link to={camperHref} className={CS_LINK}>{`${v.camperName} ›`}</Link>
                )}
              </>
            )}
            {v.householdCmId !== null && (
              <>
                {' · '}
                <Link to={householdHref(v.householdCmId, view)} className={CS_LINK}>
                  {`${v.householdName ?? ''} ›`}
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      {v.fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          {v.fields.map((f, i) => (
            <div key={`${String(i)}:${f.label}`} className="contents">
              <dt className="text-muted-foreground whitespace-nowrap">{f.label}</dt>
              <dd className="tabular-nums">
                {f.kind === 'removed' ? (
                  `removed (was ${f.before ?? '—'})`
                ) : f.kind === 'added' ? (
                  f.after
                ) : (
                  <>
                    <s className="text-muted-foreground">{f.before}</s>{' '}
                    <span className="text-muted-foreground">→</span> {f.after}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        // A rules row has no fields: its words ("Round 3  Draft → Approved") are its lines.
        v.lines.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,1fr)]">
            {v.lines.map((text, i) => (
              <dd key={`${String(i)}:${text}`} className="text-muted-foreground">
                {text}
              </dd>
            ))}
          </dl>
        )
      )}
      {v.hidden > 0 && (
        <div
          className={CS_SMALL}
        >{`and ${String(v.hidden)} recorded ${v.hidden === 1 ? 'detail' : 'details'} not listed`}</div>
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
  const { groups, rest } = compactGroups(detail.data.rows, view, sessions)
  const intake = operation.kind === 'intake'
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.head} className={BLOCK}>
          <CompactTable group={group} />
        </div>
      ))}
      {intake && rest.length > 0 ? (
        <div className={`${BLOCK} space-y-1`}>
          <div className="font-semibold">Also in this run</div>
          <div className={CS_SMALL}>{runSummary(rest)}</div>
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
      {links.manyFamilies !== null && <span className={CS_SMALL}>{links.manyFamilies}</span>}
      {links.rules !== null && (
        <Link to={links.rules.href} className={CS_LINK}>
          {links.rules.label}
        </Link>
      )}
      {links.nothing !== null && <span className={CS_SMALL}>{links.nothing}</span>}
    </div>
  )
}

/** The opened row (spec §7.2 D, owner 10-06): why | What changed | Open, split by dashed amber rules, at 14/20. */
export function HistoryPanels({
  operation,
  view,
}: {
  operation: ApiAidHistoryOperation
  view: AidView
}) {
  const words = operationWords(operation)
  return (
    <div
      data-testid="history-panels"
      className={`${CS_PANEL} grid grid-cols-[min(384px,30%)_minmax(0,1fr)_auto]`}
    >
      <div className="flex flex-col gap-1.5 pr-[18px]">
        <p>
          {operation.reason === '' ? (
            <span className="text-muted-foreground">No reason recorded.</span>
          ) : (
            `“${operation.reason}”`
          )}
        </p>
        <p className={CS_PMETA}>
          <b className="text-foreground font-medium">{actorWords(operation.actor)}</b>
          {` · ${formatCampDateTime(operation.at)} · `}
          <span className={CS_PILL[KIND_TONE[operation.kind]]}>{KIND_LABELS[operation.kind]}</span>
        </p>
        <p>{words.what}</p>
        <p
          className={CS_PMETA}
        >{`${String(operation.rows)} rows · operation ${operation.operation_id}`}</p>
      </div>
      <div className={`border-l px-[14px] ${CS_PANEL_RULE}`}>
        <div className={`${CS_PANEL_HEAD} mb-1`}>What changed</div>
        <WhatChanged operation={operation} view={view} />
      </div>
      <div className={`max-w-[220px] min-w-[140px] border-l pl-[14px] ${CS_PANEL_RULE}`}>
        <div className={`${CS_PANEL_HEAD} mb-1`}>Open</div>
        <OpenPanel operation={operation} view={view} />
      </div>
    </div>
  )
}
