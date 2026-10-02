import { useState } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioCompare } from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_SECONDARY,
  FIELD_INLINE,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../../admin/lodging/lodgingStyles'
import { NEGATIVE_INK } from '../../kit/aidStyles'
import { BINDING_TEXT, TABLE_CARD } from '../../kit/kitStyles'
import { formatMoney } from '../../kit/money'
import { isSeasonDay } from '../historyModel'
import { BELOW_HEADING, TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY_TEXT } from '../seasonStyles'
import {
  lastSeasonHeading,
  resultRows,
  settingRows,
  tierRows,
  type CompareCell,
  type CompareRow,
} from './compareModel'
import { DRAFT_CHIP, DRAFT_COLUMN, START_CHIP, UP_INK, VARIANT_CHIP } from './scenarioStyles'

interface CompareProps {
  /** Undefined while the first read is out or after it failed: the toolbar stays either way (I1). */
  readonly compare: ApiAidScenarioCompare | undefined
  readonly loading: boolean
  /** The server's words, when the read was refused and nothing older is showing. */
  readonly error: string | null
  /** The table is the previous answer while the next one loads. */
  readonly stale: boolean
  readonly requestSet: AidRequestSet
  readonly onRequestSet: (set: AidRequestSet) => void
  readonly lastSeason: boolean
  readonly onLastSeason: (on: boolean) => void
  readonly byTier: boolean
  readonly onByTier: (on: boolean) => void
  /** "Make A1 the rules draft…" on a kept option's column (D39); the draft's column has none. */
  readonly onPromote?: ((code: string) => void) | undefined
}

function Cell({ cell, tint }: { cell: CompareCell; tint: boolean }) {
  const tone = cell.negative ? NEGATIVE_INK : cell.changed ? BINDING_TEXT : ''
  return (
    <td className={`${TD_MONEY} ${tone} ${tint ? DRAFT_COLUMN : ''}`}>
      {cell.up === undefined || cell.down === undefined ? (
        cell.text
      ) : (
        <>
          <span className={UP_INK}>{`▲${String(cell.up)}`}</span>{' '}
          <span className={NEGATIVE_INK}>{`▼${String(cell.down)}`}</span>
        </>
      )}
    </td>
  )
}

/** A column's code as PR 4's chips draw it: Draft, a starting point (A, B), a variant (A1, B2). */
function chipFor(code: string): { text: string; style: string } {
  if (code === 'draft') return { text: 'Draft', style: DRAFT_CHIP }
  return { text: code, style: /\d/.test(code) ? VARIANT_CHIP : START_CHIP }
}

function Rows({
  rows,
  extra,
}: {
  rows: readonly CompareRow[]
  extra: (row: CompareRow) => string | null
}) {
  return (
    <>
      {rows.map((row) => {
        const last = extra(row)
        return (
          <tr
            key={row.key}
            data-compare-row={row.key}
            className={row.informational ? 'text-muted-foreground text-xs italic' : ''}
          >
            <td className={TD_LABEL}>{row.label}</td>
            {row.cells.map((cell, index) => (
              <Cell key={index} cell={cell} tint={index === 0} />
            ))}
            {last !== null && <td className={`${TD_MONEY} text-muted-foreground`}>{last}</td>}
          </tr>
        )
      })}
    </>
  )
}

function Section({ title, span }: { title: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className={BELOW_HEADING}>
        {title}
      </td>
    </tr>
  )
}

/**
 * The "Received through" date box. A browser fires `change` on every digit once the box holds a
 * whole day, and a typed year passes through 0002-…, so nothing is written per change: the day lands
 * on leaving the box or Enter (as History's date boxes). Only an empty box or a day in a season's
 * year is kept; a partly typed box reads '' too (badInput) and is put back in the DOM, since with no
 * URL day React sees no change to undo.
 */
function ThroughBox({ current, onDay }: { current: string; onDay: (day: string | null) => void }) {
  const [text, setText] = useState(current)
  const [seen, setSeen] = useState(current)
  if (current !== seen) {
    setSeen(current)
    setText(current)
  }
  const commit = (input: HTMLInputElement) => {
    if (input.validity.badInput) {
      input.value = current
      setText(current)
      return
    }
    if (text === current) return
    if (text === '') onDay(null)
    else if (isSeasonDay(text)) onDay(text)
    else setText(current)
  }
  return (
    <label className="inline-flex items-center gap-1.5">
      Received through
      <input
        type="date"
        aria-label="Received through"
        className={FIELD_INLINE}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget)
        }}
      />
    </label>
  )
}

/**
 * The compare (spec §7.4; D38; RPT-17, RPT-18, RPT-32; scenarios-v2.html): the draft first, beside up
 * to four ticked kept options, all on the same frozen snapshot: the settings (changed ones in amber),
 * the results, and by tier the money against what was asked. A request set (D138) and last season as
 * posted (RPT-17) are view settings in the URL. It prints for the board.
 */
export function ScenarioCompare({
  compare,
  loading,
  error,
  stale,
  requestSet,
  onRequestSet,
  lastSeason,
  onLastSeason,
  byTier,
  onByTier,
  onPromote,
}: CompareProps) {
  const columns = compare?.columns ?? []
  const last = lastSeason ? (compare?.last_season ?? null) : null
  const span = columns.length + 1 + (last === null ? 0 : 1)
  const views = [...columns.map((c) => c.committee ?? null), ...(last === null ? [] : [last.view])]
  const postedIndex = last === null ? null : columns.length
  const set = columns[0]?.results.request_set ?? null
  const lastFigure = (row: CompareRow): string | null => {
    if (last === null) return null
    const view = last.view
    if (view === null) return '—'
    if (row.key === 'round1') return formatMoney(view.round1)
    if (row.key === 'round2') return formatMoney(view.round2)
    if (row.key === 'pct_of_budget')
      return view.round1_pct_of_budget === null ? '—' : `${String(view.round1_pct_of_budget)}%`
    return '—'
  }

  return (
    <div className="space-y-2" data-testid="scenario-compare">
      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <span className="text-muted-foreground">Count</span>
        <button
          type="button"
          className={requestSet.kind === 'all' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          onClick={() => onRequestSet({ kind: 'all' })}
        >
          Every frozen request
        </button>
        <button
          type="button"
          className={requestSet.kind === 'deadline' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          onClick={() => onRequestSet({ kind: 'deadline' })}
        >
          By the Round 1 deadline
        </button>
        <ThroughBox
          current={requestSet.kind === 'date' ? requestSet.date : ''}
          onDay={(day) =>
            onRequestSet(day === null ? { kind: 'all' } : { kind: 'date', date: day })
          }
        />
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={lastSeason}
            onChange={(event) => onLastSeason(event.target.checked)}
          />
          Last season as posted
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={byTier}
            onChange={(event) => onByTier(event.target.checked)}
          />
          By tier
        </label>
        <button
          type="button"
          className={`${BUTTON_SECONDARY} ml-auto`}
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>
      {error !== null && compare === undefined && <p className={AMBER_NOTE}>{error}</p>}
      {loading && compare === undefined && error === null && (
        <p className="text-muted-foreground text-sm">Loading the compare…</p>
      )}
      {set !== null && (
        <p className={`text-sm font-medium ${stale ? 'opacity-60' : ''}`}>
          {`Every scenario figure counts ${set.label}: ${String(set.left_out)} left out`}
          {set.unknown > 0 && `, ${String(set.unknown)} with no received date left out too`}
          {last === null ? '' : '; last season is as posted'}
          {'.'}
        </p>
      )}
      {/* Its slot is always there, so the table never jumps when it appears. */}
      <p className={`text-muted-foreground text-xs ${stale ? '' : 'invisible'}`}>Updating…</p>
      {compare !== undefined && (
        <div
          className={`${TABLE_CARD} ${stale ? 'opacity-60' : ''}`}
          data-testid="scenario-compare-table"
          data-stale={stale ? '' : undefined}
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={TH_LABEL} />
                {columns.map((column, index) => {
                  const chip = chipFor(column.code)
                  return (
                    <th
                      key={column.code}
                      className={`${TH_MONEY_TEXT} align-bottom ${index === 0 ? DRAFT_COLUMN : 'bg-muted'}`}
                    >
                      <span className={chip.style}>{chip.text}</span>
                      <div className="text-muted-foreground ml-auto max-w-48 text-xs font-normal">
                        {column.label}
                      </div>
                      {onPromote !== undefined && index > 0 && (
                        <button
                          type="button"
                          className="text-primary ml-auto block text-xs font-normal hover:underline print:hidden"
                          onClick={() => onPromote(column.code)}
                        >
                          {`Make ${column.code} the rules draft…`}
                        </button>
                      )}
                    </th>
                  )
                })}
                {last !== null && (
                  <th className={`${TH_MONEY_TEXT} bg-muted align-bottom`}>
                    {lastSeasonHeading(last)}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <Section title="Settings (amber: changed)" span={span} />
              <Rows rows={settingRows(columns)} extra={() => (last === null ? null : '—')} />
              <Section title="Results" span={span} />
              <Rows rows={resultRows(columns)} extra={lastFigure} />
              {byTier && (
                <>
                  <Section title="Round 1 by tier, against what was asked" span={span} />
                  <Rows rows={tierRows(views, 1, postedIndex)} extra={() => null} />
                  <Section title="Round 2 by tier, against what was asked" span={span} />
                  <Rows rows={tierRows(views, 2, postedIndex)} extra={() => null} />
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs print:hidden">
        Your draft is always the first column. Check kept options on the left to compare them.
      </p>
    </div>
  )
}
