import { Zap } from 'lucide-react'
import { useId, useState } from 'react'

export interface SweepPanelSession {
  id: string
  cm_id: number
  name: string
  year: number
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

export interface SweepPanelProps {
  sessions: SweepPanelSession[]
  scenarios: SweepPanelScenario[]
  onRunSweep: (req: SweepPanelPayload) => void | Promise<void>
  onCancelSweep: (sweepId: string) => void
  inFlightSweep: { sweep_id: string; completed: number; total: number } | null
}

const DEFAULT_BUDGETS = [30, 60, 180, 300]

export function SweepPanel({
  sessions,
  scenarios,
  onRunSweep,
  onCancelSweep,
  inFlightSweep,
}: SweepPanelProps) {
  // The user's explicit session pick (null = follow default — the last session in
  // the list, which is typically the most recent / highest cm_id). Tracked
  // separately from the resolved value so we don't need an effect to backfill
  // when sessions data arrives after the first render.
  const [pickedSessionCmId, setPickedSessionCmId] = useState<number | null>(null)
  const [pickedSourceValue, setPickedSourceValue] = useState<string>('production')
  const [budgets, setBudgets] = useState<number[]>(DEFAULT_BUDGETS)
  const [label, setLabel] = useState<string>('')

  const sessionCmId = pickedSessionCmId ?? sessions[sessions.length - 1]?.cm_id ?? 0
  const sessionScenarios = scenarios.filter((s) => s.session_id === sessionCmId)
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
    const next = window.prompt('Add budget in seconds (e.g., 90):')
    const n = next ? parseInt(next, 10) : NaN
    if (!Number.isFinite(n) || n <= 0) return
    setBudgets((prev) => (prev.includes(n) ? prev : [...prev, n].sort((a, b) => a - b)))
  }

  return (
    <div className="shadow-lodge rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">
            <Zap className="h-4 w-4" /> Run benchmark sweep
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Sequential runs at each time budget. Inputs frozen at kickoff.
          </p>
        </div>
      </div>

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
              <option value="production">Production</option>
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
            <button
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

      {inFlightSweep ? (
        <div className="bg-forest-50 border-forest-200 mt-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          <span className="text-forest-700 font-medium">
            Sweep {inFlightSweep.sweep_id} in progress
          </span>
          <span className="text-gray-600">
            — {inFlightSweep.completed} of {inFlightSweep.total} complete
          </span>
          <button
            onClick={() => onCancelSweep(inFlightSweep.sweep_id)}
            className="ml-auto rounded border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            ⨯ Cancel after current
          </button>
        </div>
      ) : null}
    </div>
  )
}
