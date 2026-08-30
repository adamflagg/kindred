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
 * `Housing synced` line is hidden: `GetFamilyCampSessionCMIDs` filters
 * `session_type = 'family'` exactly, so on an adult weekend the chain skips
 * both expensive jobs — 13½ minutes to refresh nothing.
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
import { useSyncStatusAPI } from '../../hooks/useSyncStatusAPI'
import {
  FAMILY_CAMP_REFRESH_CHAIN,
  FAMILY_CAMP_REFRESH_SECONDS,
  useSyncSequenceRun,
} from '../../hooks/useSyncSequenceRun'
import { invalidateLodgingRegistryQueries, queryKeys } from '../../utils/queryKeys'

/**
 * The total, to the nearest half minute — "13½ minutes". Halves rather than
 * whole minutes because the ruled copy is "the ~13½ min total" and rounding
 * 13 m 31 s up to "14 minutes" overstates a number staff are being asked to
 * commit to.
 */
function formatChainTotal(seconds: number): string {
  const halves = Math.round((seconds / 60) * 2) / 2
  const whole = Math.floor(halves)
  return `${whole}${halves - whole === 0.5 ? '½' : ''} minutes`
}

/** The running readout — whole minutes, because it is a moving estimate. */
function formatRemaining(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'less than a minute left'
  return `about ${minutes} min left`
}

export function RefreshHousingButton() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const { data: syncStatus } = useSyncStatusAPI()

  const run = useSyncSequenceRun({
    chain: FAMILY_CAMP_REFRESH_CHAIN,
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
      // list of every weekend reader; `syncStatus` is added because the
      // `Housing synced` line beside this button reads the terminal job's
      // end_time and must reset with it.
      invalidateLodgingRegistryQueries(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
      toast.success('Housing refreshed from CampMinder')
    },
  })

  const startRefresh = useMutation({
    mutationFn: () => syncService.refreshFamilyCamp(fetchWithAuth),
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

  const lastSynced = syncStatus?.lodging_assignments?.end_time

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
        title="Refresh housing from CampMinder"
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
          <p>
            {lastSynced !== undefined
              ? `Housing was last refreshed ${formatDistanceToNow(new Date(lastSynced), { addSuffix: true })}. Anything staff entered in CampMinder since then is not here yet.`
              : 'Anything staff entered in CampMinder today is not here yet.'}
          </p>
          <p className="text-muted-foreground">
            Pulling it in takes about {formatChainTotal(FAMILY_CAMP_REFRESH_SECONDS)}. You can keep
            working — when it is done the housing will refresh itself.
          </p>
        </div>
      </Modal>
    </>
  )
}
