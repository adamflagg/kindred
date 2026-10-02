import { Link } from 'react-router'

import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import type { AidView } from '../kit/asOf'
import { DefRef } from '../kit/DefinitionNotes'
import { PILL, TABLE_CARD } from '../kit/kitStyles'
import { Money } from '../kit/MoneyText'
import { countWords } from '../requests/views'
import {
  BUDGET_COLUMNS,
  COLUMN_HEADERS,
  NO_POOL,
  cellHref,
  cellValue,
  cellWords,
  confirmedHref,
  confirmedWords,
  overWords,
  pendingNote,
  type BelowLine,
  type BudgetColumn,
  type BudgetRow,
} from './budgetModel'
import {
  BELOW_HEADING,
  FIGURE_LINK,
  POOL_LINE,
  TD_LABEL,
  TD_MONEY,
  TH_LABEL,
  TH_MONEY,
  TOTAL_LINE,
} from './seasonStyles'

interface BudgetTableProps {
  readonly rows: readonly BudgetRow[]
  readonly below: readonly BelowLine[]
  readonly view: AidView
  /** The approved version that priced these figures; Allocated opens it (null: none approved). */
  readonly rulesVersion: number | null
  readonly folded: ReadonlySet<string>
  readonly onToggle: (pool: string) => void
  /** A figure's note number on this surface (useAidDefinitions('season-rounds-budget').numberOf). */
  readonly numberOf: (key: string) => number | null
}

export function Note({ n }: { n: number | null }) {
  return n === null ? null : <DefRef n={n} />
}

const INDENT: Record<BudgetRow['kind'], string> = {
  pool: '',
  total: '',
  round: 'pl-6',
  pending: 'pl-10',
}

const LINE: Record<BudgetRow['kind'], string> = {
  pool: POOL_LINE,
  total: TOTAL_LINE,
  round: '',
  pending: 'text-muted-foreground',
}

function Label({
  row,
  folded,
  onToggle,
  numberOf,
}: Pick<BudgetTableProps, 'folded' | 'onToggle' | 'numberOf'> & { row: BudgetRow }) {
  if (row.kind === 'pool' && row.pool !== NO_POOL) {
    return (
      <button type="button" className="hover:underline" onClick={() => onToggle(row.pool)}>
        {folded.has(row.pool) ? '▸' : '▾'} {row.label}
      </button>
    )
  }
  return (
    <>
      {row.label}
      {row.kind === 'pending' && <Note n={numberOf('pending_approval')} />}
    </>
  )
}

function Figure({
  row,
  column,
  view,
  rulesVersion,
  numberOf,
}: {
  row: BudgetRow
  column: BudgetColumn
  view: AidView
  rulesVersion: number | null
  numberOf: (key: string) => number | null
}) {
  // A Pending approval line holds only its Needs an offer figure; its other cells stay blank, as
  // the mock draws them: "—" here means a past date's unknown (Task 4 m1).
  if (row.kind === 'pending' && column !== 'needs_offer') return null
  const href = cellHref(row, column, view, rulesVersion)
  // Needs an offer reads "n · $X" (read 2); every other column is its dollars alone.
  const money =
    column === 'needs_offer' ? (
      <span className="tabular-nums">{cellWords(row, column)}</span>
    ) : (
      <Money value={cellValue(row, column)} />
    )
  const over = overWords(row, column)
  const pending = column === 'needs_offer' ? pendingNote(row) : null
  const confirmed = column === 'posted' ? confirmedWords(row) : null
  const confirmedTo = confirmed === null ? null : confirmedHref(row, view)
  return (
    <>
      {href === null ? (
        money
      ) : (
        <Link to={href} className={FIGURE_LINK}>
          {money}
        </Link>
      )}
      {over !== null && <span className={`${PILL.amber} ml-1.5`}>{over}</span>}
      {pending !== null && (
        <div className="text-muted-foreground text-xs font-normal">{pending}</div>
      )}
      {confirmed !== null && (
        <div className={`${AMBER_NOTE} font-normal`}>
          {confirmedTo === null ? (
            confirmed
          ) : (
            <Link to={confirmedTo} className={FIGURE_LINK}>
              {confirmed}
            </Link>
          )}
          <Note n={numberOf('unconfirmed')} />
        </div>
      )}
    </>
  )
}

/** Held carries a count and no amount (unknown until resolved); every other line is its dollars. */
const showsCountAlone = (line: BelowLine) => line.amount === null && line.count !== null

function BelowFigure({ line }: { line: BelowLine }) {
  const figure = showsCountAlone(line) ? countWords(line.count) : <Money value={line.amount} />
  return (
    <>
      {line.href === null ? (
        figure
      ) : (
        <Link to={line.href} className={`text-primary ${FIGURE_LINK}`}>
          {figure}
        </Link>
      )}
      {line.note !== null && <span className="text-muted-foreground"> · {line.note}</span>}
    </>
  )
}

/** A line whose figure is dollars names its requests in the label: "(38 fam · 41 req)". */
const belowLabel = (line: BelowLine) =>
  !showsCountAlone(line) && line.count !== null
    ? `${line.label} (${countWords(line.count)})`
    : line.label

/**
 * Rounds & budget's table (§7.2; D53; budget-v5.html C): the rules' pools × Rounds 1–3 and the
 * total, with Allocated · Posted · Accepted · Needs an offer · Remaining, Pending approval as its own
 * line under Round 3 (D79), and below the line what is shown but never counted (§5.3).
 */
export function BudgetTable({
  rows,
  below,
  view,
  rulesVersion,
  folded,
  onToggle,
  numberOf,
}: BudgetTableProps) {
  return (
    <div className={TABLE_CARD}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={TH_LABEL}>Pool · round</th>
            {BUDGET_COLUMNS.map((column) => (
              <th key={column} className={TH_MONEY}>
                {COLUMN_HEADERS[column].header}
                <Note n={numberOf(COLUMN_HEADERS[column].note)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={LINE[row.kind]} data-budget-row={row.key}>
              <td className={`${TD_LABEL} ${INDENT[row.kind]}`}>
                <Label row={row} folded={folded} onToggle={onToggle} numberOf={numberOf} />
              </td>
              {BUDGET_COLUMNS.map((column) => (
                <td key={column} className={TD_MONEY}>
                  <Figure
                    row={row}
                    column={column}
                    view={view}
                    rulesVersion={rulesVersion}
                    numberOf={numberOf}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {below.length > 0 && (
          <tbody>
            <tr>
              <td colSpan={BUDGET_COLUMNS.length + 1} className={BELOW_HEADING}>
                Shown, not counted against the budget
                <Note n={numberOf('below_the_line')} />
              </td>
            </tr>
            {below.map((line) => (
              <tr key={line.key} data-below-line={line.key}>
                <td className={`${TD_LABEL} text-muted-foreground`}>{belowLabel(line)}</td>
                <td colSpan={BUDGET_COLUMNS.length} className={`${TD_LABEL} tabular-nums`}>
                  <BelowFigure line={line} />
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  )
}
