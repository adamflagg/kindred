/**
 * The way out of an empty scenario.
 *
 * #1974 made a lodging scenario REPLACE the CampMinder mirror rather than
 * overlay it, which is what summer's draft table already did. The consequence
 * is user-visible and unmissable: a freshly created scenario renders a board
 * with nothing on it — every family gone — which reads as a broken page rather
 * than as a blank plan. This says what happened and offers the seed.
 */
import { Copy, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { useSeedScenario } from '../../hooks/useSeedScenario'

export interface SeedScenarioNoticeProps {
  year: number
  sessionCmId: number
  /** Non-empty — this never renders in mirror mode. */
  scenario: string
  /** How many families this weekend has, for the prompt's wording. */
  partiesTotal: number
}

export function SeedScenarioNotice({
  year,
  sessionCmId,
  scenario,
  partiesTotal,
}: SeedScenarioNoticeProps) {
  const { seed, isSeeding } = useSeedScenario(year, sessionCmId)

  // The hook re-throws a real failure so the create modal can show it in its
  // own error box. Here there is no such box: this is a button on a page, so
  // the toast IS the report.
  const handleSeed = async () => {
    try {
      await seed(scenario)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to seed the scenario')
    }
  }

  return (
    <div className="border-primary/30 bg-primary/5 mt-3 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="min-w-[240px] flex-1">
        <p className="text-sm font-semibold">This plan is empty.</p>
        <p className="text-muted-foreground text-sm">
          A scenario is a plan of its own — it does not show CampMinder&rsquo;s placements until you
          copy them in. This weekend has {partiesTotal} {partiesTotal === 1 ? 'family' : 'families'}
          .
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          void handleSeed()
        }}
        disabled={isSeeding}
        className="btn-primary flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
      >
        {isSeeding ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        Start from CampMinder
      </button>
    </div>
  )
}
