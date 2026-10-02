import { useState } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioCompare } from '../../../../types/api-types'
import {
  BUTTON_SECONDARY,
  FIELD_INLINE,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../../admin/lodging/lodgingStyles'
import { NEGATIVE_INK } from '../../kit/aidStyles'
import { BINDING_TEXT, TABLE_CARD } from '../../kit/kitStyles'
import { formatMoney } from '../../kit/money'
import { isSeasonDay } from '../historyModel'
import { BELOW_HEADING, TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from '../seasonStyles'
import {
  lastSeasonHeading,
  resultRows,
  settingRows,
  tierRows,
  type CompareCell,
  type CompareRow,
} from './compareModel'

interface CompareProps {
  readonly compare: ApiAidScenarioCompare
  readonly requestSet: AidRequestSet
  readonly onRequestSet: (set: AidRequestSet) => void
  readonly lastSeason: boolean
  readonly onLastSeason: (on: boolean) => void
  readonly byTier: boolean
  readonly onByTier: (on: boolean) => void
}

function Cell({ cell }: { cell: CompareCell }) {
  const tone = cell.negative ? NEGATIVE_INK : cell.changed ? BINDING_TEXT : ''
  return <td className={`${TD_MONEY} ${tone}`}>{cell.text}</td>
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
              <Cell key={index} cell={cell} />
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
  requestSet,
  onRequestSet,
  lastSeason,
  onLastSeason,
  byTier,
  onByTier,
}: CompareProps) {
  const columns = compare.columns
  const last = lastSeason ? (compare.last_season ?? null) : null
  const span = columns.length + 1 + (last === null ? 0 : 1)
  const views = [...columns.map((c) => c.committee ?? null), ...(last === null ? [] : [last.view])]
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
      {set !== null && (
        <p className="text-sm font-medium">
          {`Every figure counts ${set.label}: ${String(set.left_out)} left out`}
          {set.unknown > 0 && `, ${String(set.unknown)} with no received date left out too`}
        </p>
      )}
      <div className={TABLE_CARD}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL} />
              {columns.map((column) => (
                <th key={column.code} className={`${TH_MONEY} align-bottom`}>
                  <span className="text-foreground font-mono font-bold">
                    {column.code === 'draft' ? 'Draft' : column.code}
                  </span>
                </th>
              ))}
              {last !== null && <th className={TH_MONEY}>{lastSeasonHeading(last)}</th>}
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
                <Rows rows={tierRows(views, 1)} extra={() => null} />
                <Section title="Round 2 by tier, against what was asked" span={span} />
                <Rows rows={tierRows(views, 2)} extra={() => null} />
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs print:hidden">
        Your draft is always the first column. Tick kept options on the left to compare them.
      </p>
    </div>
  )
}
