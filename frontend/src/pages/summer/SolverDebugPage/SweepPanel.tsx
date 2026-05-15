import { ChevronDown, ChevronRight, Zap } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

const SWEEP_PANEL_STORAGE_KEY = 'solver-debug.sweep-panel-expanded'

export interface SweepPanelSession {
  id: string
  cm_id: number
  name: string
  year: number
  attendee_count?: number // optional — older callers may not provide it
}

export interface SweepPanelScenario {
  id: string
  name: string
  session_id: number
}

export interface SweepPanelPayload {
  session_id?: number
  scenario_id?: string
  time_budgets: number[]
  label?: string
}

export interface SweepBudgetProgress {
  seconds: number
  walltime: number | null
  state: 'done' | 'running' | 'pending'
}

export interface InFlightSweep {
  sweep_id: string
  completed: number
  total: number
  budgets?: SweepBudgetProgress[]
}

export interface SweepPanelProps {
  sessions: SweepPanelSession[]
  scenarios: SweepPanelScenario[]
  onRunSweep: (req: SweepPanelPayload) => void | Promise<void>
  onCancelSweep: (sweepId: string) => void
  inFlightSweep: InFlightSweep | null
  preCheckImpossibilityCount?: number
  preCheckEntirelyImpossibleCount?: number
  preCheckIsLoading?: boolean
  preCheckIsError?: boolean
  onOpenPreCheck?: () => void
  onSessionChange?: (sessionCmId: number) => void
}

function formatBudget(b: SweepBudgetProgress): string {
  if (b.state === 'done')
    return b.walltime !== null
      ? `${b.seconds}s done in ${b.walltime.toFixed(1)}s`
      : `${b.seconds}s done`
  if (b.state === 'running') return `${b.seconds}s running…`
  return `${b.seconds}s pending`
}

const DEFAULT_BUDGETS = [30, 60, 180, 300]

export function SweepPanel({
  sessions,
  scenarios,
  onRunSweep,
  onCancelSweep,
  inFlightSweep,
  preCheckImpossibilityCount,
  preCheckEntirelyImpossibleCount,
  preCheckIsLoading,
  preCheckIsError,
  onOpenPreCheck,
  onSessionChange,
}: SweepPanelProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem(SWEEP_PANEL_STORAGE_KEY)
    return stored == null ? true : stored === 'true'
  })

  const isMounted = useRef(false)
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      return
    }
    localStorage.setItem(SWEEP_PANEL_STORAGE_KEY, String(expanded))
  }, [expanded])

  // The user's explicit session pick (null = follow default — the last session in
  // the list, which is typically the most recent / highest cm_id). Tracked
  // separately from the resolved value so we don't need an effect to backfill
  // when sessions data arrives after the first render.
  const [pickedSessionCmId, setPickedSessionCmId] = useState<number | null>(null)
  const [pickedSourceValue, setPickedSourceValue] = useState<string>('production')
  const [budgets, setBudgets] = useState<number[]>(DEFAULT_BUDGETS)
  const [budgetDraft, setBudgetDraft] = useState<string>('')
  const [label, setLabel] = useState<string>('')

  const sessionCmId = pickedSessionCmId ?? sessions[sessions.length - 1]?.cm_id ?? 0
  const sessionScenarios = scenarios.filter((s) => s.session_id === sessionCmId)

  // Notify parent when the resolved session changes (including initial default).
  useEffect(() => {
    if (sessionCmId > 0) onSessionChange?.(sessionCmId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire when sessionCmId changes; onSessionChange is a stable callback prop
  }, [sessionCmId])
  // Drop the picked source if it no longer belongs to the selected session,
  // otherwise we'd submit a scenario_id from a different session. Computed each
  // render so changing the session immediately clears a stale scenario.
  const sourceValue =
    pickedSourceValue === 'production' || sessionScenarios.some((s) => s.id === pickedSourceValue)
      ? pickedSourceValue
      : 'production'

  const sessionId = useId()
  const sourceId = useId()
  const labelId = useId()

  const isSubmittable = sessionCmId > 0 && budgets.length > 0 && !inFlightSweep

  const handleRun = () => {
    if (!isSubmittable) return
    const payload: SweepPanelPayload = {
      time_budgets: budgets,
    }
    if (label) payload.label = label
    if (sourceValue === 'production') {
      payload.session_id = sessionCmId
    } else {
      payload.scenario_id = sourceValue
    }
    void onRunSweep(payload)
  }

  const removeBudget = (b: number) =>
    setBudgets((prev) => {
      const idx = prev.indexOf(b)
      if (idx === -1) return prev
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
    })

  const addBudget = () => {
    const n = budgetDraft ? parseInt(budgetDraft, 10) : NaN
    if (!Number.isFinite(n) || n <= 0) return
    setBudgets((prev) => (prev.includes(n) ? prev : [...prev, n].sort((a, b) => a - b)))
    setBudgetDraft('')
  }

  return (
    <div className="shadow-lodge rounded-xl border border-gray-200 bg-white">
      {/* Header row — always visible */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Zap className="h-4 w-4 text-amber-500" />
          Run benchmark sweep
        </h3>
        <div className="flex items-center gap-2">
          {preCheckIsLoading && typeof preCheckImpossibilityCount !== 'number' ? (
            <button
              type="button"
              disabled
              className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500"
            >
              … Pre-check · checking
            </button>
          ) : preCheckIsError && typeof preCheckImpossibilityCount !== 'number' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenPreCheck?.()
              }}
              className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              ⚠ Pre-check · failed
            </button>
          ) : typeof preCheckImpossibilityCount === 'number' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenPreCheck?.()
              }}
              className={
                preCheckImpossibilityCount > 0
                  ? 'rounded-full border border-amber-400 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200'
                  : 'rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 hover:bg-green-100'
              }
            >
              {preCheckImpossibilityCount > 0
                ? `⚠ Pre-check · ${preCheckImpossibilityCount} issues`
                : '✓ Pre-check · no issues'}
            </button>
          ) : null}
          {typeof preCheckEntirelyImpossibleCount === 'number' &&
          preCheckEntirelyImpossibleCount > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenPreCheck?.()
              }}
              className="rounded-full border border-red-400 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-900 hover:bg-red-200"
            >
              {`🛑 ${preCheckEntirelyImpossibleCount} entirely-impossible MP ${
                preCheckEntirelyImpossibleCount === 1 ? 'camper' : 'campers'
              }`}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-gray-500 hover:text-gray-700"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* In-flight banner — always visible (status info, not config) */}
      {inFlightSweep ? (
        <div className="bg-forest-50 border-forest-200 flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm">
          <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          <span className="text-forest-700 font-medium">
            Sweep {inFlightSweep.sweep_id} in progress
          </span>
          {inFlightSweep.total > 0 ? (
            <span className="text-gray-600">
              — {inFlightSweep.completed} of {inFlightSweep.total} complete
            </span>
          ) : (
            <span className="text-gray-600">— spinning up…</span>
          )}
          {inFlightSweep.budgets && inFlightSweep.budgets.length > 0 ? (
            <span className="text-xs text-gray-500">
              ({inFlightSweep.budgets.map(formatBudget).join(', ')})
            </span>
          ) : null}
          <button
            onClick={() => onCancelSweep(inFlightSweep.sweep_id)}
            className="ml-auto rounded border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            ⨯ Cancel after current
          </button>
        </div>
      ) : null}

      {/* Collapsible body */}
      {expanded && (
        <div className="p-5">
          <p className="mb-4 text-xs text-gray-500">
            Sequential runs at each time budget. Inputs frozen at kickoff.
          </p>

          <div className="mb-4 grid grid-cols-12 items-end gap-4">
            <div className="col-span-3">
              <label
                htmlFor={sessionId}
                className="text-xs font-medium tracking-wide text-gray-600 uppercase"
              >
                Session
              </label>
              <select
                id={sessionId}
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                value={sessionCmId}
                onChange={(e) => setPickedSessionCmId(Number(e.target.value))}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.cm_id}>
                    {s.name} — {s.year}
                    {s.attendee_count != null ? ` (${s.attendee_count})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-4">
              <label
                htmlFor={sourceId}
                className="text-xs font-medium tracking-wide text-gray-600 uppercase"
              >
                Source
              </label>
              <select
                id={sourceId}
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                value={sourceValue}
                onChange={(e) => setPickedSourceValue(e.target.value)}
              >
                <optgroup label="CampMinder">
                  <option value="production">CM</option>
                </optgroup>
                {sessionScenarios.length > 0 ? (
                  <optgroup label="Scenarios">
                    {sessionScenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <div className="col-span-3">
              <span className="text-xs font-medium tracking-wide text-gray-600 uppercase">
                Time budgets
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {budgets.map((b) => (
                  <button
                    key={b}
                    onClick={() => removeBudget(b)}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-900"
                    title="click to remove"
                  >
                    {b}s ×
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  aria-label="Add budget in seconds"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addBudget()
                    }
                  }}
                  placeholder="90"
                  className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={addBudget}
                  className="rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-sm text-gray-500 hover:border-gray-400"
                >
                  + add
                </button>
              </div>
            </div>
            <div className="col-span-2">
              <button
                onClick={handleRun}
                disabled={!isSubmittable}
                className="from-forest-500 to-forest-700 w-full rounded-lg bg-gradient-to-br px-4 py-2 text-sm font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                ▶ Run sweep
              </button>
            </div>
            <div className="col-span-12">
              <label
                htmlFor={labelId}
                className="text-xs font-medium tracking-wide text-gray-600 uppercase"
              >
                Label (optional)
              </label>
              <input
                id={labelId}
                className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. post-grade-spread-cleanup"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
