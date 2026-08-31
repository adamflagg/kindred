/**
 * `Refresh Housing` — the weekend twin of summer's `Refresh Bunking`
 * (kindred#2478 §4). Four states, all of them ruled in §4.1:
 *
 * | Press    | a modal, short, stating the cost — the ONLY place the cost is said |
 * | Running  | replaces this button IN PLACE; nothing else on the page changes    |
 * | Cutover  | invalidate, toast, the `Housing synced` timestamp resets           |
 * | Failure  | an error toast, nothing more — the shape summer already uses       |
 *
 * ⛔ No cancel: the behavioural model is press-and-walk-away, which makes a
 * cancel button nearly unreachable. ⛔ No count in the toast: "Housing
 * refreshed", never "4 households changed cabin" — a count is the scenario /
 * CampMinder compare arriving through the back door, and it belongs to
 * kindred#2478 §5, which is deliberately its own feature.
 *
 * ⛔ NOT RENDERED ON ADULT WEEKENDS. The caller hides it, the same way the
 * `Housing synced` line is hidden: an adult session is not in the family-camp
 * cohort either way, so the chain skips both expensive jobs and spends its
 * whole runtime refreshing nothing.
 *
 * ⚠️ The MECHANISM moved even though the behaviour did not. That reasoning used
 * to rest on `GetFamilyCampSessionCMIDs` filtering `session_type = 'family'`,
 * which is only on the UNSCOPED path — and this button now always takes the
 * scoped one. The scoped path is guarded instead by `handleRefreshFamilyCamp`,
 * which refuses a session that is not a family-camp weekend in the year
 * (kindred#2601). Hiding the button is still right; cite the guard, not the
 * resolver.
 *
 * Why the run is not tracked in React state: see `useSyncSequenceRun`. The
 * running state is derived from the server's job statuses, so it survives a
 * reload, a navigation and a weekend switch, and it is still correct for a
 * second staff member who opens the board halfway through.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'

import { Modal } from '../ui'
import { syncService } from '../../services/sync'
import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { FAMILY_CAMP_REFRESH_CHAIN, useSyncSequenceRun } from '../../hooks/useSyncSequenceRun'
import { invalidateLodgingRegistryQueries, queryKeys } from '../../utils/queryKeys'
import { weekendHousingSyncedAt } from './weekendFreshness'

/** The running readout — whole minutes, because it is a moving estimate. */
function formatRemaining(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'less than a minute left'
  return `about ${minutes} min left`
}

/**
 * The weekend this press acts on. `AppLayout` only mounts the button once
 * `useWeekendShellSession` has resolved one, so this is never absent — which is
 * why it is required rather than optional (kindred#2601).
 */
interface RefreshHousingButtonProps {
  /**
   * `housing_synced_at` is resolved PER WEEKEND server-side out of `sync_runs`
   * history (kindred#2617), so by the time it arrives here it is already a fact
   * about this weekend — `""` when no run has ever covered it.
   */
  session: { session_cm_id: number; name: string; housing_synced_at?: string }
}

export function RefreshHousingButton({ session }: RefreshHousingButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()

  const run = useSyncSequenceRun({
    chain: FAMILY_CAMP_REFRESH_CHAIN,
    // Scopes the readout, the toast and the invalidation below to THIS weekend.
    // Without it, a refresh started on another weekend drives this button —
    // announcing and cache-busting a refresh that never touched what is on
    // screen (kindred#2601).
    session: String(session.session_cm_id),
    onComplete: (outcome) => {
      if (outcome === 'failed') {
        // §4.4: the two jobs that touch anything staff sees run LAST and are
        // cheap, so an abort leaves the board exactly as it was. Nothing to
        // invalidate, nothing to explain — an error toast, same as summer.
        toast.error('Housing refresh failed. The board still shows the previous data.')
        return
      }
      // 🚨 THE LOAD-BEARING HALF (§4.3). Weekend queries carry the app default
      // 30 minute staleTime, so without this the board keeps rendering
      // PRE-REFRESH placements for half an hour, under a timestamp reading
      // "just now" and a toast saying "refreshed" — strictly worse than not
      // shipping the feature. `invalidateLodgingRegistryQueries` is the shared
      // list of every weekend reader, and since kindred#2617 that list is what
      // resets BOTH freshness readouts too: `housing_synced_at` rides on
      // `/sessions`, which it invalidates. `syncStatus` is invalidated beside
      // it so the admin dashboard and summer's own lines see the finished run
      // rather than the last polled frame of it.
      invalidateLodgingRegistryQueries(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
      toast.success('Housing refreshed from CampMinder')
    },
  })

  const startRefresh = useMutation({
    mutationFn: () => syncService.refreshFamilyCamp(fetchWithAuth, session.session_cm_id),
    onError: (error: Error) => {
      // The POST never started a chain, so the detector must be disarmed or it
      // would sit forcing polling for its whole arming window.
      run.abandon()
      toast.error(`Failed to refresh housing: ${error.message}`)
    },
  })

  if (run.isRunning) {
    const percent = Math.round(run.progress * 100)
    return (
      <div className="text-muted-foreground flex flex-col gap-1 px-4 py-2 text-xs">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
          Refreshing housing — {formatRemaining(run.remainingSeconds)}
        </span>
        <div
          className="bg-muted h-1.5 w-40 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Housing refresh progress"
          aria-valuenow={percent}
        >
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    )
  }

  // Shared with the nav's "Housing synced" line — see weekendHousingSyncedAt for
  // why the source is the custom-values job and why undefined is a real answer.
  // Both surfaces read it off the SAME weekend object, so the two cannot drift.
  const lastSynced = weekendHousingSyncedAt(session)

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="btn-primary nav-btn-icon-only px-4 py-2"
        title="Refresh family camp housing from CampMinder"
      >
        <RefreshCw className="h-4 w-4 flex-shrink-0" />
        <span className="nav-text-short">Refresh</span>
        <span className="nav-text-full">Refresh Housing</span>
      </button>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Refresh housing for ${session.name}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 pt-4">
            <button
              onClick={() => setIsModalOpen(false)}
              className="btn-secondary px-4 py-2 text-sm"
            >
              Not now
            </button>
            <button
              onClick={() => {
                void run.start()
                startRefresh.mutate()
                setIsModalOpen(false)
              }}
              className="btn-primary px-4 py-2 text-sm"
            >
              Start refresh
            </button>
          </div>
        }
      >
        {/*
          SHORT, and deliberately WITHOUT a job or table list (§4.1): staff do
          not need the six service names, and the one thing this dialog exists
          to say is what the refresh costs.
        */}
        <div className="text-foreground space-y-3 text-sm">
          {/*
            ⚠️ THE TIMESTAMP DOES NOT NAME THE WEEKEND, and does not need to:
            `lastSynced` arrives already resolved to THIS weekend, or is
            undefined. Naming it here would add nothing and would re-invite the
            season-wide claim that made the first draft of kindred#2601 wrong.
            The weekend name stays on the TITLE, which is a claim about what the
            press will do.
          */}
          {lastSynced !== undefined && (
            <p>
              Anything entered in CampMinder since{' '}
              {formatDistanceToNow(new Date(lastSynced), { addSuffix: true })} won't show here yet.
            </p>
          )}
          {/*
            A RANGE, not the chain total. The press covers one weekend, and the
            weekends differ enough that a single figure would be wrong for most
            of them — the largest is ~7x the smallest by cohort. Stating the
            band is the honest version of a number staff are asked to commit
            to, and it is deliberately not derived from
            FAMILY_CAMP_REFRESH_SECONDS: that constant is calibrated to the
            LARGEST weekend so the progress bar never stalls, which makes it the
            top of this range rather than its middle (kindred#2601).
          */}
          <p className="text-muted-foreground">
            Pulling it in takes about 2–4 minutes. You can keep working — when it is done the
            housing will refresh itself.
          </p>
        </div>
      </Modal>
    </>
  )
}
