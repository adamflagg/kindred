import { useState } from 'react'
import { Link } from 'react-router'

import type { ApiAidTodayLine, ApiAidTodayNextUp } from '../../../types/api-types'
import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { aidHref, type AidView } from '../kit/asOf'
import { AidFoldCard } from '../kit/Cards'
import { CS_BTN, CS_EMPTY, CS_LINK_SM, CS_META } from '../kit/csType'
import { Cut } from '../kit/Cut'
import { ROW_HIGHLIGHT, TABLE, TD, TH } from '../kit/kitStyles'
import { Money } from '../kit/MoneyText'
import { AidNameChips, type NameChip } from '../kit/NameChips'
import { StatusPill } from '../kit/Pills'
import { aidCellShortName } from '../kit/sessionShort'
import { REQUEST_VIEWS } from '../requests/views'
import { countWords, LINE_WORDS, reasonWords, type TodayKey } from './todayModel'

/** The lines whose next households a queue walk can step through (spec: the three casework queues with a Requests view). */
// eslint-disable-next-line react-refresh/only-export-components -- constant shared with the Today pages
export const WALKABLE: readonly TodayKey[] = [
  'needs_offer',
  'waiting_on_family',
  'pending_approval',
]

/** Days past which a walkable line is overdue (the server's thresholds, shown in the pill's title). */
const LIMIT: Readonly<Record<string, number>> = {
  needs_offer: 10,
  waiting_on_family: 14,
  pending_approval: 3,
}

const FUNDERS = '/aid/money/funders'
const DRAWER_N = 5

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

/** Lines whose reasons are named things (a rules section, an equity field): the name alone, no count. */
const NAMED: readonly string[] = ['rules_sections', 'equity_field_never_true']

const reasonsText = (line: ApiAidTodayLine): string =>
  (line.reasons ?? [])
    .map((r) => {
      const words = reasonWords(line.key, r)
      return r.items > 0 && !NAMED.includes(line.key) ? `${words} ${String(r.items)}` : words
    })
    .join(' · ')

/** " household" is added only to a label that does not already say it ("Household 9100124"). */
const householdWords = (label: string): string =>
  /household/i.test(label) ? label : `${label} household`

const householdHref = (id: number, view: AidView, extra: Record<string, string> = {}) =>
  aidHref(`/aid/households/${String(id)}`, view, extra)

function NextUpCell({ line, view }: { line: ApiAidTodayLine; view: AidView }) {
  const names = namesOf(line)
  const nextUp = nextUpOf(line)
  if (names.length > 0) {
    const chips: NameChip[] = names.map((name) => ({
      key: name,
      label: name,
      href: aidHref(FUNDERS, view),
      title: `Open Funders · ${name}`,
    }))
    return <AidNameChips chips={chips} total={line.families ?? line.items} />
  }
  if (nextUp.length > 0) {
    const limit = LIMIT[line.key]
    const walkable = isWalkableKey(line.key)
    const chips: NameChip[] = nextUp.map((n) => {
      const label = n.tiebreak ? `${n.label} ${n.tiebreak}` : n.label
      const days = walkable ? (n.days ?? null) : null
      return {
        key: `${String(n.household_cm_id)}-${n.tiebreak ?? ''}`,
        label,
        days,
        late: days !== null && limit !== undefined && days > limit,
        href: householdHref(n.household_cm_id, view),
        title:
          days === null
            ? `Open the ${householdWords(label)}`
            : `Open the ${householdWords(label)} · waiting ${String(days)} days`,
      }
    })
    return <AidNameChips chips={chips} total={line.families ?? line.items} />
  }
  return <Cut text={reasonsText(line)} />
}

function Drawer({ line, view, slug }: { line: ApiAidTodayLine; view: AidView; slug: string }) {
  const limit = LIMIT[line.key]
  const nextUp = nextUpOf(line)
  const first = nextUp[0]
  const open = openHref(line.key, view)
  const entries = nextUp.slice(0, DRAWER_N)
  return (
    <div data-testid="todo-drawer" className="px-3 py-2">
      <table className="w-full text-sm">
        <tbody>
          {entries.map((n) => {
            const what = [
              (n.camper_name ?? '').split(' ')[0] ?? '',
              aidCellShortName(n.session_name ?? '', n.session_type ?? ''),
              n.round === null || n.round === undefined ? '' : `R${String(n.round)}`,
            ]
              .filter((part) => part !== '')
              .join(' · ')
            const days = n.days ?? null
            const late = limit !== undefined && days !== null && days > limit
            return (
              <tr
                key={`${String(n.household_cm_id)}-${n.tiebreak ?? ''}`}
                data-testid="drawer-household"
              >
                <td className="py-0.5 pr-3">
                  <Link className={CS_LINK_SM} to={householdHref(n.household_cm_id, view)}>
                    {householdWords(n.label)}
                  </Link>
                </td>
                <td className="py-0.5 pr-3" title={what}>
                  {what}
                </td>
                <td className="py-0.5 pr-3 tabular-nums">
                  <Money value={n.ask ?? null} />
                  {' ask'}
                </td>
                <td
                  className={`py-0.5 tabular-nums ${late ? `${POOL_NEGATIVE_INK} font-bold` : 'text-muted-foreground'}`}
                >
                  {days === null ? '' : `${String(days)} days`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3">
        {first !== undefined && (
          <Link
            className={CS_BTN}
            to={householdHref(first.household_cm_id, view, { from: slug })}
            title="Walk this queue one household at a time"
          >
            Start Queue Walk
          </Link>
        )}
        <span className={CS_META}>{String(line.items)} in the queue</span>
        {open !== undefined && (
          <Link className={`${CS_LINK_SM} ml-auto`} to={open}>
            Open ›
          </Link>
        )}
      </div>
    </div>
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
  empty,
}: {
  readonly lines: readonly ApiAidTodayLine[]
  readonly rest: readonly ApiAidTodayLine[]
  readonly view: AidView
  readonly ranked?: boolean
  readonly nextHead?: string
  readonly restTitle?: string
  readonly restMeta?: string
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
  const span = ranked ? 6 : 5

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 ? (
        // An empty `empty` draws nothing: finance's registrar fold is a rest table with no lines of its own.
        empty === '' ? null : (
          <div className={CS_EMPTY}>
            <b>Nothing is waiting on you.</b> {empty}
          </div>
        )
      ) : (
        <div className="bg-card border-border shadow-lodge-sm overflow-x-auto rounded-xl border">
          <table className={TABLE}>
            <colgroup>
              {ranked && <col style={{ width: 34 }} />}
              <col style={{ width: 230 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                {ranked && <th className={TH} />}
                <th className={TH}>{ranked ? 'To-do' : 'Concern'}</th>
                <th className={TH}>Count</th>
                <th className={TH}>{nextHead}</th>
                <th className={TH} />
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const expandable = canOpen(line)
                const isOpen = expandable && open.has(line.key)
                const href = openHref(line.key, view)
                const limit = LIMIT[line.key]
                const label = wordsFor(line.key)
                const tone = isOpen ? ROW_HIGHLIGHT : ''
                const slug = viewSlug(line.key)
                return [
                  <tr
                    key={line.key}
                    data-testid="todo-row"
                    className={`${tone} ${expandable ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                      if (!expandable || (e.target as HTMLElement).closest('a, button')) return
                      toggle(line.key)
                    }}
                  >
                    {ranked && (
                      <td className={`${TD} text-muted-foreground tabular-nums`}>
                        {String(i + 1)}
                      </td>
                    )}
                    <td className={`${TD} font-bold whitespace-nowrap`} title={label}>
                      {expandable && (
                        <span className="mr-1 inline-block w-3 text-[10px]">
                          {isOpen ? '▾' : '▸'}
                        </span>
                      )}
                      <span data-testid="todo-label">{label}</span>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`} title={countWords(line)}>
                      {countWords(line)}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <NextUpCell line={line} view={view} />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
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
                    <td className={`${TD} whitespace-nowrap`}>
                      {href !== undefined && (
                        <Link className={CS_LINK_SM} to={href}>
                          Open ›
                        </Link>
                      )}
                    </td>
                  </tr>,
                  isOpen && slug !== undefined ? (
                    <tr key={`${line.key}-drawer`} className={tone}>
                      <td className={TD} colSpan={span}>
                        <Drawer line={line} view={view} slug={slug} />
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      {rest.length > 0 && (
        <AidFoldCard
          title={restTitle}
          meta={meta}
          open={foldOpen}
          onToggle={() => {
            setFoldOpen((o) => !o)
          }}
        >
          <table className={TABLE}>
            <colgroup>
              <col style={{ width: 230 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>Queue</th>
                <th className={TH}>Count</th>
                <th className={TH}>Why</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rest.map((line) => {
                const href = openHref(line.key, view)
                const muted = line.items === 0 ? 'text-muted-foreground' : ''
                const label = wordsFor(line.key)
                return (
                  <tr key={line.key} className={muted}>
                    <td className={`${TD} whitespace-nowrap`} title={label}>
                      {label}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{countWords(line)}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Cut text={reasonsText(line)} />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
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
      )}
    </div>
  )
}
