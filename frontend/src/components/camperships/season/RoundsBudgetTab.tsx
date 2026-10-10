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
import { campToday } from '../kit/dates'
import { headingLines } from '../kit/report'
import { AidCsvButton } from '../kit/CsvButton'
import { AidCards } from '../kit/Cards'
import { CS_LINK, CS_PANEL } from '../kit/csType'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { scopePool, budgetCsvName } from './budgetModel'
import {
  BUDGET_CSV_HEADERS,
  budgetCsvRows,
  ledgerRows,
  poolCards,
  previewMoves,
} from './budgetCards'
import { BudgetHead, SeasonCard } from './BudgetCard'
import { EditPlan } from './EditPlan'
import { BudgetFoldLines } from './BudgetFoldLines'
import { DEFAULT_OPEN_LINES, openKeys, toggleOpenKey } from './foldLinesModel'
import { draftPillWords, planOf, previewFigures, type TypedPlan } from './planModel'
import { PoolCard } from './PoolCard'
import { RoundsTable } from './RoundsTable'
import { ROUNDS_NOTE_ALSO_BOLD, roundsNote } from './roundsNotes'
import { useSeasonChrome } from './seasonChrome'

const SURFACE = 'season-rounds-budget'

/** Download CSV on the tab bar's right (spec §5.2 H): every pool, round and the total, whatever is folded. */
export function RoundsBudgetCsv() {
  const year = useYear()
  const asOf = useAidAsOf()
  const [params] = useSearchParams()
  const pool = params.get('pool')
  const budget = useAidBudget().data
  if (budget === undefined) return null
  const scope = pool === null ? null : (budget.pools.find((p) => p.pool === pool)?.label ?? null)
  const download = () => {
    // The Reports CSVs' heading block (name; season and as-of), then the table, then the absolute Link line.
    const heading = {
      title: scope === null ? 'Rounds & budget' : `Rounds & budget · ${scope}`,
      season: year,
      figuresOn: budget.as_of ?? (asOf.kind === 'past' ? asOf.date : campToday()),
      live: asOf.kind !== 'past',
      basis: null,
    }
    const [first = [], ...rest] = [
      ...headingLines(heading).map((line) => [line]),
      [],
      BUDGET_CSV_HEADERS,
      ...budgetCsvRows(budget, pool),
      [],
      ['Link', window.location.href],
    ]
    downloadCsv(
      buildCsvContent(first, rest),
      budgetCsvName(year, scope, asOf.kind === 'past' ? asOf.date : null)
    )
  }
  return <AidCsvButton onDownload={download} />
}

function RoundsBudgetBody({ budget, view }: { budget: ApiAidBudget; view: AidView }) {
  const [params, setParams] = useSearchParams()
  const pool = params.get('pool')
  const openRaw = params.get('open')
  // Open by default: every pool (its rounds) and Where each round stands; the first toggle writes ?open= as the whole state.
  const defaults = useMemo(
    () => [...poolCards(budget, pool).map((card) => card.key), ...DEFAULT_OPEN_LINES],
    [budget, pool]
  )
  const open = useMemo(() => openKeys(openRaw, defaults), [openRaw, defaults])
  const { numberOf } = useAidDefinitions(SURFACE)
  const { hasPermission } = usePermissions()
  const finance = hasPermission(Permission.FINANCIAL_AID_RULES)
  const draft = useAidRulesDraft({ enabled: finance })
  const live = view.asOf.kind !== 'past'
  const { approving, locked, relocks } = useSeasonChrome()
  // Edit Plan… waits while the Approve panel is open, as Rules' Edit… does ("Approve or cancel first.").
  // It also serves a season with no approved rules yet: the editor then sets the first budget (the mock's no-rules state).
  const canPlan = finance && live && draft.data !== undefined && !approving && !locked
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState<TypedPlan | null>(null)
  // Lock Again closes Edit Plan… (its Save would only meet the server's refusal); expiry leaves it open.
  const [seenRelocks, setSeenRelocks] = useState(relocks)
  if (seenRelocks !== relocks) {
    setSeenRelocks(relocks)
    setEditing(false)
    setTyped(null)
  }
  // A past date shows no editor: arriving at one closes the plan, or the cards would keep previewing typing nobody can
  // save or cancel. A one-pool page keeps it (the Budget heading stays there, the plan edits in place).
  const [seenLive, setSeenLive] = useState(live)
  if (seenLive !== live) {
    setSeenLive(live)
    if (editing && !live) {
      setEditing(false)
      setTyped(null)
    }
  }
  // setParams changes identity on every URL change; a ref keeps `toggle` stable.
  const setParamsRef = useRef(setParams)
  useEffect(() => {
    setParamsRef.current = setParams
  }, [setParams])
  const defaultsRef = useRef(defaults)
  useEffect(() => {
    defaultsRef.current = defaults
  }, [defaults])
  // A pool or section is a view state, so it lives in the URL (D15), replaced rather than pushed.
  const toggle = useCallback(
    (key: string) =>
      setParamsRef.current(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete('fold') // today's ?fold= is retired
          next.set('open', toggleOpenKey(openKeys(previous.get('open'), defaultsRef.current), key))
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
    setTyped(plan.plan)
    setEditing(true)
  }
  const clearScope = () =>
    setParamsRef.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('pool')
        return next
      },
      { replace: true }
    )
  const cards = poolCards(budget, pool)
  const ledger = ledgerRows(budget, pool, view, open)
  return (
    <div>
      <BudgetHead
        budget={budget}
        view={view}
        editing={editing}
        previewing={editing && previewMoves(budget, preview)}
        draftPill={draftPill}
        canPlan={canPlan}
        onEditPlan={openEditor}
        scope={pool === null ? null : scope.label}
        onClearScope={clearScope}
      />
      {editing && draft.data !== undefined && plan !== null && typed !== null && (
        <div className="mb-2">
          <EditPlan
            draft={draft.data}
            pools={plan.pools}
            opened={plan.plan}
            typed={typed}
            shareNote={roundsNote(numberOf, 'share')}
            inEffectTotal={budget.rules_version === null ? null : budget.total.total.allocated}
            onType={setTyped}
            onClose={() => {
              setEditing(false)
              setTyped(null)
            }}
          />
        </div>
      )}
      {cards.length > 0 && (
        <AidCards count={Math.max(4, cards.length + (pool === null ? 1 : 0))}>
          {cards.map((card) => (
            <PoolCard
              key={card.key}
              card={card}
              budget={budget}
              view={view}
              numberOf={numberOf}
              preview={preview}
            />
          ))}
          {pool === null && (
            <SeasonCard budget={budget} view={view} numberOf={numberOf} preview={preview} />
          )}
        </AidCards>
      )}
      <div className="mt-2">
        <RoundsTable rows={ledger} open={open} onToggle={toggle} numberOf={numberOf} />
      </div>
      <BudgetFoldLines
        budget={budget}
        pool={pool}
        view={view}
        open={open}
        onToggle={toggle}
        numberOf={numberOf}
      />
      <AidDefinitionNotes surface={SURFACE} alsoBold={ROUNDS_NOTE_ALSO_BOLD} />
    </div>
  )
}

/**
 * Season › Rounds & budget (spec §5; final design, layout C): the Budget heading, a strip of compact cards (a pool each,
 * the season in the band), ONE ruled table (pools open into their rounds, the season in the band), four folding
 * sections and the notes. A failed refetch keeps the figures.
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
