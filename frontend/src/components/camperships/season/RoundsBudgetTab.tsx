import { Download } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidBudget } from '../../../hooks/camperships/useAidBudget'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidRulesDraft } from '../../../hooks/camperships/useAidRules'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidBudget } from '../../../types/api-types'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { withLinkLine } from '../kit/csv'
import { CS_BTN_TOOL, CS_LINK, CS_PANEL, CS_PILL } from '../kit/csType'
import { scopePool, budgetCsvName } from './budgetModel'
import { BUDGET_CSV_HEADERS, budgetCsvRows, noPoolCommitted, poolCards } from './budgetCards'
import { BudgetCard } from './BudgetCard'
import { EditPlan } from './EditPlan'
import { BudgetFoldLines } from './BudgetFoldLines'
import { parseOpenKeys, toggleOpenKey } from './foldLinesModel'
import { draftPillWords, planOf, previewFigures, type TypedPlan } from './planModel'
import { NoPoolCard, PoolCard } from './PoolCard'
import { useSeasonChrome } from './seasonChrome'

const SURFACE = 'season-rounds-budget'

/** "‹Pool› only · All Pools ›" on the tab bar's right (spec §4), only on a one-pool page. */
export function RoundsBudgetScope() {
  const year = useYear()
  const asOf = useAidAsOf()
  const [params] = useSearchParams()
  const pool = params.get('pool')
  const budget = useAidBudget().data
  const scope = budget && pool !== null ? budget.pools.find((p) => p.pool === pool) : undefined
  if (scope === undefined) return null
  return (
    <span className={CS_PANEL}>
      <b>{scope.label}</b> only ·{' '}
      <Link to={aidHref('/aid/season/rounds-budget', { year, asOf })} className={CS_LINK}>
        All Pools ›
      </Link>
    </span>
  )
}

/** Download CSV on the tab bar's right (spec §5.2 H): every pool, round and the total, whatever is folded. */
export function RoundsBudgetCsv() {
  const year = useYear()
  const asOf = useAidAsOf()
  const [params] = useSearchParams()
  const pool = params.get('pool')
  const budget = useAidBudget().data
  if (budget === undefined) return null
  const scope = pool === null ? null : (budget.pools.find((p) => p.pool === pool)?.label ?? null)
  const download = () =>
    downloadCsv(
      buildCsvContent(
        BUDGET_CSV_HEADERS,
        withLinkLine(budgetCsvRows(budget, pool), window.location.href)
      ),
      budgetCsvName(year, scope, asOf.kind === 'past' ? asOf.date : null)
    )
  return (
    <button type="button" className={CS_BTN_TOOL} onClick={download}>
      <Download className="h-4 w-4" />
      Download CSV
    </button>
  )
}

function RoundsBudgetBody({ budget, view }: { budget: ApiAidBudget; view: AidView }) {
  const [params, setParams] = useSearchParams()
  const pool = params.get('pool')
  const openRaw = params.get('open')
  const open = useMemo(() => parseOpenKeys(openRaw), [openRaw])
  const { numberOf } = useAidDefinitions(SURFACE)
  const { hasPermission } = usePermissions()
  const finance = hasPermission(Permission.FINANCIAL_AID_RULES)
  const draft = useAidRulesDraft({ enabled: finance })
  const live = view.asOf.kind !== 'past'
  const { approving } = useSeasonChrome()
  // Edit Plan… waits while the Approve panel is open, as Rules' Edit… does ("Approve or cancel first.").
  const canPlan =
    finance && live && budget.rules_version !== null && draft.data !== undefined && !approving
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState<TypedPlan | null>(null)
  // setParams changes identity on every URL change; a ref keeps `toggle` stable.
  const setParamsRef = useRef(setParams)
  useEffect(() => {
    setParamsRef.current = setParams
  }, [setParams])
  // A card or fold line is a view state, so it lives in the URL (D15), replaced rather than pushed.
  const toggle = useCallback(
    (key: string) =>
      setParamsRef.current(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete('fold') // today's ?fold= is retired
          const value = toggleOpenKey(parseOpenKeys(previous.get('open')), key)
          if (value === null) next.delete('open')
          else next.set('open', value)
          return next
        },
        { replace: true }
      ),
    []
  )
  const scope = scopePool(budget, pool)
  if (scope === undefined) {
    return (
      <p className={`${CS_PANEL} text-muted-foreground`}>
        {`No pool "${pool ?? ''}" in ${String(view.year)}'s budget. `}
        <Link to={aidHref('/aid/season/rounds-budget', view)} className={CS_LINK}>
          All Pools ›
        </Link>
      </p>
    )
  }
  const plan =
    draft.data === undefined
      ? null
      : planOf(draft.data.document.budget as Parameters<typeof planOf>[0])
  const keys = plan?.pools.map((p) => p.key) ?? []
  const preview = editing && typed !== null ? previewFigures(typed, budget, keys) : null
  const budgetRow = draft.data?.sections.find((s) => s.section === 'budget')
  const draftPill =
    finance &&
    draft.data !== undefined &&
    budgetRow?.status.state === 'draft' &&
    budgetRow.changes.length > 0
      ? draftPillWords(draft.data.version, budgetRow.changes.length)
      : null
  const openEditor = () => {
    if (plan === null) return
    if (pool !== null) {
      setParamsRef.current(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete('pool')
          return next
        },
        { replace: true }
      )
    }
    setTyped(plan.plan)
    setEditing(true)
  }
  const cards = poolCards(budget, pool)
  const none = pool === null ? noPoolCommitted(budget) : null
  const scopedPills =
    pool === null ? null : (
      <>
        {budget.rules_version === null && (
          <span className={CS_PILL.amber}>no approved rules: nothing allocated yet</span>
        )}
        {!live && <span className={CS_PILL.muted}>past date: exact figures only</span>}
      </>
    )
  return (
    <div className="space-y-3">
      {pool === null && (
        <BudgetCard
          budget={budget}
          view={view}
          open={open}
          onToggle={toggle}
          numberOf={numberOf}
          preview={preview}
          editing={editing}
          draftPill={draftPill}
          canPlan={canPlan}
          onEditPlan={openEditor}
        >
          {editing && draft.data !== undefined && plan !== null && typed !== null && (
            <EditPlan
              draft={draft.data}
              pools={plan.pools}
              opened={plan.plan}
              typed={typed}
              shareNote={numberOf('share')}
              onType={setTyped}
              onClose={() => {
                setEditing(false)
                setTyped(null)
              }}
            />
          )}
        </BudgetCard>
      )}
      {cards.map((card) => (
        <PoolCard
          key={card.key}
          card={card}
          budget={budget}
          view={view}
          open={open}
          onToggle={toggle}
          numberOf={numberOf}
          preview={preview}
          editing={editing}
          canPlan={canPlan}
          onEditPlan={openEditor}
          scopedPills={scopedPills}
        />
      ))}
      {none !== null && <NoPoolCard committed={none} />}
      <BudgetFoldLines
        budget={budget}
        pool={pool}
        view={view}
        open={open}
        onToggle={toggle}
        numberOf={numberOf}
      />
    </div>
  )
}

/**
 * Season › Rounds & budget (spec §5; budget-v9.html): lead with the budget and work down: total → pool shares → what
 * each round committed → Remaining. The definitions sit in the "Notes" fold line. A failed refetch keeps the figures.
 */
export function RoundsBudgetTab() {
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const budget = useAidBudget()
  return (
    <QueryGuard
      isLoading={budget.isLoading}
      error={budget.data ? null : budget.error}
      data={budget.data}
      label="Rounds & budget"
    >
      {(data) => <RoundsBudgetBody budget={data} view={view} />}
    </QueryGuard>
  )
}
