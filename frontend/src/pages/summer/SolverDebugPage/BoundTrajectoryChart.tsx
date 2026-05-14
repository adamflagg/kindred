import type { SolverRunStats } from '../../../hooks/useSolverRuns'

interface Props {
  objectiveTrajectory: NonNullable<SolverRunStats['objective_trajectory']>
  boundTrajectory: NonNullable<SolverRunStats['bound_trajectory']>
}

const W = 560
const H = 160
const PAD = 8

/**
 * Hand-rolled SVG line chart for the Tier 2 best-bound trajectory. Two series
 * — objective (blue) and best bound (red) — share one time axis. No charting
 * dependency in the repo; this stays a small, dependency-free component.
 */
export function BoundTrajectoryChart({ objectiveTrajectory, boundTrajectory }: Props) {
  const objPts = objectiveTrajectory
  const bndPts = boundTrajectory

  if (objPts.length === 0 && bndPts.length === 0) {
    return (
      <div className="text-sm text-gray-400">
        No trajectory data — the solver returned no intermediate solutions.
      </div>
    )
  }

  const allT = [...objPts.map((p) => p.t), ...bndPts.map((p) => p.t)]
  // Y-axis spans only the drawn series: objective_trajectory points also carry
  // a `bound`, but the bound line is plotted from bound_trajectory — including
  // objPts' bound here would inflate the axis when bound_trajectory is empty.
  const allV = [...objPts.map((p) => p.objective), ...bndPts.map((p) => p.bound)]
  const tMin = Math.min(...allT)
  const tMax = Math.max(...allT)
  const vMin = Math.min(...allV)
  const vMax = Math.max(...allV)
  const tSpan = tMax - tMin || 1
  const vSpan = vMax - vMin || 1

  const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - ((v - vMin) / vSpan) * (H - 2 * PAD)

  const objLine = objPts.map((p) => `${x(p.t)},${y(p.objective)}`).join(' ')
  const bndLine = bndPts.map((p) => `${x(p.t)},${y(p.bound)}`).join(' ')

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded bg-gray-50"
        role="img"
        aria-label="Best-bound and objective trajectory over solve time"
      >
        {bndPts.length > 0 ? (
          <polyline points={bndLine} fill="none" stroke="#dc2626" strokeWidth={1.5} />
        ) : null}
        {objPts.length > 0 ? (
          <polyline points={objLine} fill="none" stroke="#2563eb" strokeWidth={1.5} />
        ) : null}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-gray-500">
        <span>
          <span className="text-blue-600" aria-hidden="true">
            ●
          </span>{' '}
          objective
        </span>
        <span>
          <span className="text-red-600" aria-hidden="true">
            ●
          </span>{' '}
          best bound
        </span>
        <span className="ml-auto">
          {tMin.toFixed(1)}s – {tMax.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}
