import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidTodayLine, ApiAidTodayNextUp } from '../../../types/api-types'
import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { aidHref, type AidView } from '../kit/asOf'
import { AidFoldCard } from '../kit/Cards'
import { CS_BTN, CS_EMPTY, CS_LINK_CELL, CS_LINK_SM, CS_SMALL } from '../kit/csType'
import { Cut } from '../kit/Cut'
import { CELL_BG, HIGHLIGHT_EDGE, ROW_HIGHLIGHT, TABLE, TABLE_CARD, TD, TH } from '../kit/kitStyles'
import { Money } from '../kit/MoneyText'
import { AidNameChips, type NameChip } from '../kit/NameChips'
import { StatusPill } from '../kit/Pills'
import { aidSessionName, aidTinyName } from '../kit/sessionShort'
import { REQUEST_VIEWS } from '../requests/views'
import {
  clockWords,
  countParts,
  countWords,
  LINE_WORDS,
  reasonsLine,
  reasonsTitle,
  type TodayKey,
} from './todayModel'

/** The lines whose next households a queue walk can step through (spec: the three casework queues with a Requests view). */
// eslint-disable-next-line react-refresh/only-export-components -- constant shared with the Today pages
export const WALKABLE: readonly TodayKey[] = [
  'needs_offer',
  'waiting_on_family',
  'pending_approval',
]

const FUNDERS = '/aid/money/funders'
const DRAWER_N = 5
// Column widths: rank, to-do, count, next up (the rest), status, open: the mock's 34 / 230 / 130 / rest / 150 / 64.
// Owner ruling 18 names a camper request by the camper's full name, so one whole chip fits Next up at 1280-1440px
// (ruling V9: never cut) with the mock's widths, and the To-do labels stay on one line. Development takes the same
// widths (ruling 19) with no status column, since none of its lines has an overdue threshold: its longest
// description chip (~274px) still fits the wider Next up.
const RANK_W = 34
const OPEN_W = 64
const LABEL_W = 230
const COUNT_W = 130
const STATUS_W = 150

/** The to-do grid's columns. The drawer and Everything else are the same grid, so they draw exactly these (ruling 19). */
function Columns({ status }: { status: boolean }) {
  return (
    <colgroup>
      <col style={{ width: RANK_W }} />
      <col style={{ width: LABEL_W }} />
      <col style={{ width: COUNT_W }} />
      <col />
      {status && <col style={{ width: STATUS_W }} />}
      <col style={{ width: OPEN_W }} />
    </colgroup>
  )
}

const isWalkableKey = (key: string): boolean => (WALKABLE as readonly string[]).includes(key)

/** The Requests view slug (`?view=`) of a queue line, from the grid's own view list; undefined for a line that is not a queue. */
function viewSlug(key: string): string | undefined {
  return REQUEST_VIEWS.find((v) => v.key === key && v.key !== 'all')?.slug
}

/**
 * Where a line's Open › goes. `key` is a string: finance's synthetic 'over_budget' line has no
 * destination and gets no link. The grid has no listed-ids parameter (its `ids=1` only shows an
 * ID column), so `late_full_coverage` and `intake` open Requests unfiltered.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared with the Today pages
export function openHref(key: TodayKey | string, view: AidView): string | undefined {
  const slug = viewSlug(key)
  if (slug !== undefined) return aidHref('/aid/requests', view, { view: slug })
  switch (key) {
    case 'grants':
      return aidHref('/aid/money/grants', view)
    case 'to_place':
      return aidHref('/aid/money/to-place', view)
    case 'late_full_coverage':
    case 'intake':
      return aidHref('/aid/requests', view)
    case 'rules_sections':
    case 'equity_field_never_true':
      return aidHref('/aid/season/rules', view)
    case 'sources':
    case 'no_contact':
    case 'no_eligibility':
    case 'needs_group':
    case 'no_grantor':
      return aidHref(FUNDERS, view)
    default:
      return undefined
  }
}

const wordsFor = (key: string): string =>
  (LINE_WORDS as Readonly<Record<string, string | undefined>>)[key] ?? key

// The generated type marks every list optional; the server always sends them.
const nextUpOf = (line: ApiAidTodayLine): readonly ApiAidTodayNextUp[] => line.next_up ?? []
const namesOf = (line: ApiAidTodayLine): readonly string[] => line.names ?? []

/** Where a development name opens in Money › Funders (audit X5): its own funder (`funder:`) or row (`row:`). */
function funderHref(link: string | undefined, view: AidView): string {
  const target = link ?? ''
  const at = target.indexOf(':')
  if (at < 1) return aidHref(FUNDERS, view)
  return aidHref(FUNDERS, view, { [target.slice(0, at)]: target.slice(at + 1) })
}

/** The count cell (audit R4, spec §5): "**31** req **23** fam", or a muted "none" at zero. */
function CountCell({ line }: { line: ApiAidTodayLine }) {
  if (line.items === 0) return <span className="text-muted-foreground">none</span>
  return (
    <>
      {countParts(line).map((p, i) => (
        <span key={p.unit}>
          {i > 0 ? ' ' : ''}
          <b>{p.figure}</b> <span className="text-muted-foreground">{p.unit}</span>
        </span>
      ))}
    </>
  )
}

/** " household" is added only to a label that does not already say it ("Household 9100124"). */
const householdWords = (label: string): string =>
  /household/i.test(label) ? label : `${label} household`

/** A chip's or drawer link's title. A camper request is named by its camper (ruling 18), so it opens their household. */
const openTitle = (n: ApiAidTodayNextUp, label: string): string =>
  n.camper_name ? `Open ${label}'s household` : `Open the ${householdWords(label)}`

const householdHref = (id: number, view: AidView, extra: Record<string, string> = {}) =>
  aidHref(`/aid/households/${String(id)}`, view, extra)

function NextUpCell({ line, view }: { line: ApiAidTodayLine; view: AidView }) {
  const names = namesOf(line)
  const nextUp = nextUpOf(line)
  if (names.length > 0) {
    // A description is quoted, as CampMinder writes it (audit D8); a funder is its name.
    const quoted = line.item_kind === 'descriptions'
    const chips: NameChip[] = names.map((name, i) => ({
      key: name,
      label: quoted ? `"${name}"` : name,
      href: funderHref(line.links?.[i], view),
      title: `Open ${quoted ? `"${name}"` : name} in Money › Funders`,
    }))
    return <AidNameChips chips={chips} total={line.families ?? line.items} />
  }
  if (nextUp.length > 0) {
    const limit = line.overdue_after_days ?? undefined
    const chips: NameChip[] = nextUp.map((n) => {
      const label = n.tiebreak ? `${n.label} ${n.tiebreak}` : n.label
      // Every line's clock the server sends (audit R11): holds, Not reconciled and grants carry days too.
      const days = n.days ?? null
      return {
        key: `${String(n.household_cm_id)}-${n.tiebreak ?? ''}`,
        label,
        days,
        late: days !== null && limit !== undefined && days > limit,
        href: householdHref(n.household_cm_id, view),
        title:
          days === null
            ? openTitle(n, label)
            : `${openTitle(n, label)} · ${clockWords(line.key, days)}`,
      }
    })
    return <AidNameChips chips={chips} total={line.families ?? line.items} />
  }
  // Owner 2a: the top reasons then "+N more", wrapping in the column rather than cut, so they read without a hover;
  // the title lists every reason.
  return (
    <span className="whitespace-normal" title={reasonsTitle(line)}>
      {reasonsLine(line)}
    </span>
  )
}

/** The drawer's session (audit X10): the short form, or the tiny one where the short form is still a long name
 *  (a TBM cohort), so the line stays one short phrase; the full name is the cell's title. */
function drawerSession(name: string, type: string): string {
  const short = aidSessionName(name, type)
  return short.length > 20 ? aidTinyName(name, type) || short : short
}

/** A drawer or fold cell: the to-do grid's own white kit cell (ruling 19: the development grid's style). */
const GRID_TD = `${TD} ${CELL_BG}`

/**
 * The opened line's households as rows of the to-do grid itself (owner ruling 19: a popped-open row, but a grid,
 * styled as the development grid, its columns the table's own): the name under To-do, the ask under Count, the
 * session and round under Next up, the days under the overdue pill. Then the walk row.
 */
function Drawer({
  line,
  view,
  slug,
  status,
}: {
  line: ApiAidTodayLine
  view: AidView
  slug: string
  status: boolean
}) {
  const limit = line.overdue_after_days ?? undefined
  const nextUp = nextUpOf(line)
  const first = nextUp[0]
  const open = openHref(line.key, view)
  const entries = nextUp.slice(0, DRAWER_N)
  return (
    <tbody data-testid="todo-drawer">
      {entries.map((n) => {
        // The link already names the camper (ruling 18), so the what is the session and round.
        const what = [
          drawerSession(n.session_name ?? '', n.session_type ?? ''),
          n.round === null || n.round === undefined ? '' : `R${String(n.round)}`,
        ]
          .filter((part) => part !== '')
          .join(' · ')
        const days = n.days ?? null
        const late = limit !== undefined && days !== null && days > limit
        const label = n.tiebreak ? `${n.label} ${n.tiebreak}` : n.label
        const dayCell = (
          <td
            className={`${GRID_TD} whitespace-nowrap tabular-nums ${late ? `${POOL_NEGATIVE_INK} font-bold` : 'text-muted-foreground'}`}
          >
            {days === null ? '' : `${String(days)} days`}
          </td>
        )
        return (
          <tr
            key={`${String(n.household_cm_id)}-${n.tiebreak ?? ''}`}
            data-testid="drawer-household"
          >
            <td className={GRID_TD} />
            {/* A name is never cut (owner 10-10): a long one wraps in its column, as the To-do label does. */}
            <td className={GRID_TD}>
              <Link
                className={CS_LINK_CELL}
                to={householdHref(n.household_cm_id, view)}
                title={openTitle(n, label)}
              >
                {label}
              </Link>
            </td>
            <td className={`${GRID_TD} text-right whitespace-nowrap tabular-nums`}>
              {n.ask === null || n.ask === undefined ? null : (
                <>
                  <Money value={n.ask} />
                  {' ask'}
                </>
              )}
            </td>
            <td className={GRID_TD} title={[what, n.session_name].filter(Boolean).join(' · ')}>
              {what}
            </td>
            {status ? (
              <>
                {dayCell}
                <td className={GRID_TD} />
              </>
            ) : (
              dayCell
            )}
          </tr>
        )
      })}
      <tr>
        <td className={GRID_TD} />
        <td className={`${GRID_TD} whitespace-nowrap`} colSpan={status ? 4 : 3}>
          <span className="flex items-center gap-2">
            {first !== undefined && (
              <Link
                className={CS_BTN}
                to={householdHref(first.household_cm_id, view, { from: slug })}
                title="Walk this queue one household at a time, oldest first"
              >
                Start Queue Walk
              </Link>
            )}
            <span className={CS_SMALL}>oldest first · {String(line.items)} in the queue</span>
          </span>
        </td>
        <td className={`${GRID_TD} align-middle whitespace-nowrap`}>
          {open !== undefined && (
            <Link className={CS_LINK_SM} to={open}>
              Open ›
            </Link>
          )}
        </td>
      </tr>
    </tbody>
  )
}

export function TodayTodos({
  lines,
  rest,
  view,
  ranked = true,
  nextHead = 'Next up',
  restTitle = 'Everything else',
  restMeta,
  restActions = [],
  statusColumn: status = true,
  empty,
}: {
  readonly lines: readonly ApiAidTodayLine[]
  readonly rest: readonly ApiAidTodayLine[]
  readonly view: AidView
  readonly ranked?: boolean
  readonly nextHead?: string
  readonly restTitle?: string
  readonly restMeta?: string
  /** The fold's header actions (finance's registrar queue: Open Requests ›, ruling V4). */
  readonly restActions?: readonly ReactNode[]
  /** The overdue-pill column. Development's lines have no threshold, so its grid draws none (ruling 19). */
  readonly statusColumn?: boolean
  readonly empty: string
}) {
  const canOpen = (l: ApiAidTodayLine) =>
    ranked && isWalkableKey(l.key) && nextUpOf(l).length > 0 && viewSlug(l.key) !== undefined
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const first = lines.find(canOpen)
    return new Set(first === undefined ? [] : [first.key])
  })
  const [foldOpen, setFoldOpen] = useState(false)
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const waiting = rest.filter((l) => l.items > 0).length
  const zero = rest.length - waiting
  const meta =
    restMeta ??
    [
      waiting > 0 ? `${String(waiting)} more waiting` : '',
      zero > 0 ? `${String(zero)} at zero` : '',
    ]
      .filter((s) => s !== '')
      .join(' · ')
  const cell = (isOpen: boolean) => `${TD} ${isOpen ? ROW_HIGHLIGHT : CELL_BG}`

  return (
    <div className="flex flex-col gap-1.5">
      {lines.length === 0 ? (
        // An empty `empty` draws nothing: finance's registrar fold is a rest table with no lines of its own.
        empty === '' ? null : (
          <div className={CS_EMPTY}>
            <b>Nothing is waiting on you.</b> {empty}
          </div>
        )
      ) : (
        <div className={TABLE_CARD}>
          <table className={TABLE}>
            {/* Unranked (Concerns) keeps the rank column empty, so its columns line up with the table above. */}
            <Columns status={status} />
            <thead>
              <tr>
                <th className={TH} />
                <th className={TH}>{ranked ? 'To-do' : 'Concern'}</th>
                <th className={TH}>Count</th>
                <th className={TH}>{nextHead}</th>
                {status && <th className={TH} />}
                <th className={TH} />
              </tr>
            </thead>
            {lines.map((line, i) => {
              const expandable = canOpen(line)
              const isOpen = expandable && open.has(line.key)
              const href = openHref(line.key, view)
              const limit = line.overdue_after_days ?? undefined
              const label = wordsFor(line.key)
              const slug = viewSlug(line.key)
              return (
                <Fragment key={line.key}>
                  <tbody>
                    <tr
                      data-testid="todo-row"
                      className={expandable ? 'cursor-pointer' : ''}
                      onClick={(e) => {
                        if (!expandable || (e.target as HTMLElement).closest('a, button')) return
                        toggle(line.key)
                      }}
                    >
                      <td
                        className={`${cell(isOpen)} text-muted-foreground text-right tabular-nums ${isOpen ? HIGHLIGHT_EDGE : ''}`}
                      >
                        {ranked ? String(i + 1) : ''}
                      </td>
                      {/* The label is the row's identity: it wraps rather than cuts (audit F11, D5). */}
                      <td className={`${cell(isOpen)} font-bold`}>
                        {expandable && (
                          <span className="text-muted-foreground mr-1 inline-block w-3 align-middle text-[10px] leading-none">
                            {isOpen ? '▾' : '▸'}
                          </span>
                        )}
                        <span data-testid="todo-label">{label}</span>
                      </td>
                      <td
                        className={`${cell(isOpen)} whitespace-nowrap tabular-nums`}
                        title={countWords(line)}
                      >
                        <CountCell line={line} />
                      </td>
                      <td className={`${cell(isOpen)} whitespace-nowrap`}>
                        <NextUpCell line={line} view={view} />
                      </td>
                      {status && (
                        <td className={`${cell(isOpen)} whitespace-nowrap`}>
                          {line.overdue && (
                            <StatusPill
                              tone="amber"
                              title={
                                limit === undefined
                                  ? 'Past its threshold, so it moved to the top.'
                                  : `Past this line's ${String(limit)}-day threshold, so it moved to the top.`
                              }
                            >
                              Overdue · {String(line.oldest_days)} days
                            </StatusPill>
                          )}
                        </td>
                      )}
                      <td className={`${cell(isOpen)} whitespace-nowrap`}>
                        {href !== undefined && (
                          <Link className={CS_LINK_SM} to={href}>
                            Open ›
                          </Link>
                        )}
                      </td>
                    </tr>
                  </tbody>
                  {isOpen && slug !== undefined && (
                    <Drawer line={line} view={view} slug={slug} status={status} />
                  )}
                </Fragment>
              )
            })}
          </table>
        </div>
      )}
      {rest.length > 0 && (
        <div className={lines.length === 0 ? '' : 'mt-1'}>
          <AidFoldCard
            title={restTitle}
            meta={meta}
            open={foldOpen}
            actions={restActions}
            onToggle={() => {
              setFoldOpen((o) => !o)
            }}
          >
            {/* The same grid as the to-dos (ruling 19): its columns, its white kit cells. Why spans Next up and the
                status column, which no queue line here fills, so its reasons have room. */}
            <table className={TABLE}>
              <Columns status={status} />
              <thead>
                <tr>
                  <th className={TH} />
                  <th className={TH}>Queue</th>
                  <th className={TH}>Count</th>
                  <th className={TH} colSpan={status ? 2 : 1}>
                    Why
                  </th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {rest.map((line) => {
                  const zero = line.items === 0
                  const href = zero ? undefined : openHref(line.key, view)
                  const muted = zero ? 'text-muted-foreground' : ''
                  const label = wordsFor(line.key)
                  return (
                    <tr key={line.key}>
                      <td className={GRID_TD} />
                      <td className={`${GRID_TD} ${muted} whitespace-nowrap`} title={label}>
                        {label}
                      </td>
                      <td className={`${GRID_TD} whitespace-nowrap tabular-nums`}>
                        <CountCell line={line} />
                      </td>
                      <td
                        className={`${GRID_TD} ${muted} whitespace-nowrap`}
                        colSpan={status ? 2 : 1}
                      >
                        <Cut
                          text={zero ? '' : reasonsLine(line)}
                          title={zero ? '' : reasonsTitle(line)}
                        />
                      </td>
                      <td className={`${GRID_TD} whitespace-nowrap`}>
                        {href !== undefined && (
                          <Link className={CS_LINK_SM} to={href}>
                            Open ›
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </AidFoldCard>
        </div>
      )}
    </div>
  )
}
