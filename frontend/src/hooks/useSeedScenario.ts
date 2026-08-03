/**
 * Seeding a weekend scenario from the CampMinder mirror.
 *
 * Shared by the two places that can start a plan: the create modal, which
 * seeds the scenario it just made, and `SeedScenarioNotice`, which is the way
 * back when a plan is empty — whether because nobody seeded it or because the
 * seed failed. Both must report a 409 and a `skipped` count identically, so
 * the behaviour lives here rather than in either caller.
 *
 * WHAT IT THROWS IS THE POINT. Success and the 409 are handled here and
 * resolve; a real failure RE-THROWS, because the two callers need different
 * things from it. The notice is a button on a page and turns it into a toast.
 * The modal has just created a scenario and must show the failure in its own
 * error box rather than close on a lie — the plan exists, empty, and staff
 * need to know the copy did not run.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'

import { copyPlacementsFromMirror } from '../services/lodgingApi'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export function useSeedScenario(year: number, sessionCmId: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [isSeeding, setIsSeeding] = useState(false)

  const seed = useCallback(
    async (scenario: string) => {
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
        // the status is the contract, an identity check would pull a class
        // into modules with no other use for it, and `instanceof` is the one
        // form of narrowing that can go false across duplicate module
        // instances. The tests reject with the real class, so the two agree.
        if (error instanceof Error && (error as { status?: number }).status === 409) {
          toast.success('This scenario was already seeded from CampMinder.')
          return
        }
        throw error
      } finally {
        // Invalidate on EVERY outcome, not just success — including the
        // re-throw, which this `finally` still runs before unwinding. A 409
        // means the rows are already there, so the empty board on screen is
        // the stale thing; and a failure part-way through a seed leaves the
        // rows it did write. Nothing refreshes on its own, since these
        // queries carry the app default 30 minute staleTime.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.weekendRoster(year, sessionCmId, scenario),
        })
        void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummary(year) })
        setIsSeeding(false)
      }
    },
    [fetchWithAuth, queryClient, year, sessionCmId]
  )

  return { seed, isSeeding }
}
