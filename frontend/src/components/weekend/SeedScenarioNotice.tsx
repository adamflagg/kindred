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
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'

import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { copyPlacementsFromMirror } from '../../services/lodgingApi'
import { queryKeys } from '../../utils/queryKeys'

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
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [isSeeding, setIsSeeding] = useState(false)

  const handleSeed = async () => {
    setIsSeeding(true)
    try {
      const { copied, skipped } = await copyPlacementsFromMirror(fetchWithAuth, {
        year,
        sessionCmId,
        scenario,
      })
      // `skipped` is mirror rows naming a party or a unit that no longer
      // resolves. Unreported, the only evidence would be a board showing
      // fewer families than CampMinder does.
      toast.success(
        skipped > 0
          ? `Copied ${String(copied)} placements. Skipped ${String(skipped)} — the family or cabin no longer resolves.`
          : `Copied ${String(copied)} placements from CampMinder.`
      )
    } catch (error) {
      // 409 is the server REFUSING a second copy, because it would overwrite
      // what staff placed and re-place everything they unplaced. That is the
      // guard working. Reporting it in red teaches staff to distrust it.
      //
      // Narrowed on the STATUS rather than on `instanceof LodgingApiError`:
      // the status is the contract, an identity check would import a class
      // this component otherwise has no use for, and `instanceof` is the one
      // form of narrowing that can go false across duplicate module
      // instances. The tests reject with the real class, so the two agree.
      if (error instanceof Error && (error as { status?: number }).status === 409) {
        toast.success('This scenario was already seeded from CampMinder.')
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to seed the scenario')
      }
    } finally {
      // Invalidate on EVERY outcome, not just success. A 409 means the rows
      // are already there, so the empty board on screen is the stale thing.
      // Nothing refreshes on its own — these queries carry the app default
      // 30 minute staleTime.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.weekendRoster(year, sessionCmId, scenario),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummary(year) })
      setIsSeeding(false)
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
