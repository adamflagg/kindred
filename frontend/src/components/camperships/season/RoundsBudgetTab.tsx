import { Download } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidBudget } from '../../../hooks/camperships/useAidBudget'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useYear } from '../../../hooks/useCurrentYear'
import type { ApiAidBudget } from '../../../types/api-types'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { AMBER_NOTE, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { withLinkLine } from '../kit/csv'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import {
  BUDGET_CSV_HEADERS,
  belowTheLine,
  budgetCsvName,
  budgetCsvRows,
  budgetTypeLines,
  budgetRows,
  parseFolded,
  scopePool,
  stripRounds,
  toggleFolded,
} from './budgetModel'
import { BudgetStrip } from './BudgetStrip'
import { BudgetTable } from './BudgetTable'
import { BudgetTypeLines } from './BudgetTypeLines'

const SURFACE = 'season-rounds-budget'

function RoundsBudgetBody({ budget, view }: { budget: ApiAidBudget; view: AidView }) {
  const [params, setParams] = useSearchParams()
  const pool = params.get('pool')
  const foldRaw = params.get('fold')
  const folded = useMemo(() => parseFolded(foldRaw), [foldRaw])
  const { numberOf } = useAidDefinitions(SURFACE)
  const scope = scopePool(budget, pool)
  const rows = useMemo(() => budgetRows(budget, { pool, folded }), [budget, pool, folded])
  const below = useMemo(() => belowTheLine(budget, pool, view), [budget, pool, view])
  const typeLines = useMemo(() => budgetTypeLines(budget, pool), [budget, pool])
  const strip = useMemo(() => stripRounds(budget.strip, view), [budget.strip, view])

  // A fold is a view state, so it lives in the URL (D15), replaced rather than pushed: Back
  // returns to the page before, not through every fold.
  // setParams changes identity on every URL change; a ref keeps `toggle` stable.
  const setParamsRef = useRef(setParams)
  useEffect(() => {
    setParamsRef.current = setParams
  }, [setParams])
  const toggle = useCallback(
    (key: string) =>
      setParamsRef.current(
        (previous) => {
          const next = new URLSearchParams(previous)
          const value = toggleFolded(parseFolded(previous.get('fold')), key)
          if (value === null) next.delete('fold')
          else next.set('fold', value)
          return next
        },
        { replace: true }
      ),
    []
  )

  const allPools = aidHref('/aid/season/rounds-budget', view)
  if (scope === undefined) {
    return (
      <p className="text-muted-foreground text-sm">
        {`No pool "${pool ?? ''}" in ${String(view.year)}'s budget. `}
        <Link to={allPools} className="text-primary hover:underline">
          All pools ›
        </Link>
      </p>
    )
  }

  const download = () =>
    downloadCsv(
      buildCsvContent(BUDGET_CSV_HEADERS, withLinkLine(budgetCsvRows(rows), window.location.href)),
      budgetCsvName(
        view.year,
        pool === null ? null : scope.label,
        view.asOf.kind === 'past' ? view.asOf.date : null
      )
    )

  return (
    <div className="space-y-3">
      {budget.rules_version === null && (
        <p className={AMBER_NOTE}>
          No approved rules price {view.year} yet, so nothing is allocated: Allocated and Remaining
          fill in once finance approves the budget.
        </p>
      )}
      {(budget.not_rebuilt ?? []).length > 0 && (
        <p className={AMBER_NOTE}>
          A past date shows what Kindred can rebuild exactly: a figure it can&apos;t reads
          &ldquo;—&rdquo;, never an estimate.
        </p>
      )}
      <BudgetStrip rounds={strip} />
      <div className="flex flex-wrap items-center gap-2.5">
        {pool !== null && (
          <span className="text-sm">
            <b>{scope.label}</b> only ·{' '}
            <Link to={allPools} className="text-primary hover:underline">
              All pools ›
            </Link>
          </span>
        )}
        <button type="button" className={`${BUTTON_SECONDARY} ml-auto`} onClick={download}>
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>
      <BudgetTable
        rows={rows}
        below={below}
        view={view}
        rulesVersion={budget.rules_version}
        folded={folded}
        onToggle={toggle}
        numberOf={numberOf}
      />
      <BudgetTypeLines lines={typeLines} />
    </div>
  )
}

/**
 * Season › Rounds & budget (spec §7.2; D44, D46, D53, D79, D153; budget-v5.html C): the strip,
 * the pools × rounds and below the line, this year only, live or as of the page's past day. A
 * background refetch that fails keeps what loaded (owner ruling Group 5).
 */
export function RoundsBudgetTab() {
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const budget = useAidBudget()
  return (
    <div className="space-y-3">
      <QueryGuard
        isLoading={budget.isLoading}
        error={budget.data ? null : budget.error}
        data={budget.data}
        label="Rounds & budget"
      >
        {(data) => <RoundsBudgetBody budget={data} view={view} />}
      </QueryGuard>
      <AidDefinitionNotes surface={SURFACE} />
    </div>
  )
}
