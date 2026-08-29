/**
 * Completion detection for an `Orchestrator.RunSyncSequence` run — the shared
 * primitive behind `Refresh Housing` (kindred#2478 §4) and the summer
 * `Refresh Bunking` invalidation (kindred#2587).
 *
 * ## Why this cannot be built on `_current_run`
 *
 * `GetCurrentRunProgress` (pocketbase/sync/orchestrator.go) switches on
 * `dailySyncRunning` / `historicalSyncRunning` / `weeklySyncRunning` /
 * `customValuesSyncRunning` and returns `""` in the default case.
 * `RunSyncSequence` sets NONE of them — its own comment says "It carries no
 * run-type flag" — and both `handleRefreshBunking` and `handleRefreshFamilyCamp`
 * go through it. So `_current_run` is ABSENT for the whole of either refresh
 * (kindred#2478 §4.2c).
 *
 * ⇒ The signal is the JOB STATUSES in `GET /api/custom/sync/status`, which
 * PR #2591 made complete by publishing the two bounded `_family_camp` jobs.
 * That absence is then useful INVERTED: a chain job running while no
 * orchestrator-level run is in flight is the server-side signature of a manual
 * targeted refresh, and it is what makes the running state survive a reload,
 * a navigation, or a weekend switch without any React state to carry it.
 *
 * ## Why the completion test is "the terminal job's end_time CHANGED"
 *
 * Not "a chain job stopped running": the polls are 3 s apart and the gap
 * between two sequential jobs is sub-second, so a poll landing in a gap would
 * otherwise announce a cutover in the middle of the run. Not "end_time is
 * newer than when I pressed" either: `end_time` is stamped by the server and
 * the press is stamped by the browser, so that comparison is at the mercy of
 * clock skew. Snapshotting the terminal job's `end_time` when the run is first
 * observed and waiting for it to differ is exact and clock-free.
 *
 * ## No new polling code
 *
 * `useSyncStatusAPI` already polls every 3 s while anything reports
 * running/pending and stops entirely at rest, and already sets
 * `refetchOnWindowFocus`. This hook subscribes to that same query — React Query
 * shares one cache entry across observers — and asks it for `forcePolling` only
 * during the ARMING GAP: the few hundred milliseconds between the POST
 * returning `{"status":"started"}` and the first job being marked running, when
 * nothing reports running and the polling would otherwise never start.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '../utils/queryKeys'
import { useSyncStatusAPI } from './useSyncStatusAPI'
import type { SyncStatus, SyncStatusResponse } from './useSyncStatusAPI'

/** One job of a refresh chain, with the measured cost used for the readout. */
export interface SyncSequenceJob {
  /** The service name exactly as `GET /api/custom/sync/status` reports it. */
  service: string
  /**
   * Average duration in seconds. Measured from `sync_runs` on the production
   * snapshot of 2026-08-23, `status='success'` (kindred#2478 §3). Used ONLY
   * for the progress readout — nothing branches on it.
   */
  seconds: number
}

/**
 * `GetRefreshFamilyCampJobs()`, in order. 13 m 31 s in total, of which the two
 * bounded custom-values jobs are 96%.
 *
 * `lodging_assignments` terminates the chain and is the one that matters:
 * `family_camp_derived` does NOT write it, so ending here rather than there is
 * what makes "the board's mirror is up to date" true.
 */
export const FAMILY_CAMP_REFRESH_CHAIN: readonly SyncSequenceJob[] = [
  { service: 'attendees', seconds: 3.3 },
  { service: 'persons', seconds: 21.0 },
  { service: 'person_custom_values_family_camp', seconds: 536.7 },
  { service: 'household_custom_values_family_camp', seconds: 242.7 },
  { service: 'family_camp_derived', seconds: 5.7 },
  { service: 'lodging_assignments', seconds: 1.8 },
]

/** The total of `FAMILY_CAMP_REFRESH_CHAIN`, ~13½ minutes. */
export const FAMILY_CAMP_REFRESH_SECONDS = FAMILY_CAMP_REFRESH_CHAIN.reduce(
  (sum, job) => sum + job.seconds,
  0
)

/**
 * `GetRefreshBunkingJobs()`, in order — ~4.7 s in total. The durations are
 * nominal rather than measured per job; nothing displays them, because summer's
 * button keeps its existing spinner (the whole run is shorter than one poll).
 */
export const BUNKING_REFRESH_CHAIN: readonly SyncSequenceJob[] = [
  { service: 'bunks', seconds: 1.0 },
  { service: 'bunk_plans', seconds: 1.5 },
  { service: 'bunk_assignments', seconds: 2.0 },
  { service: 'stranded_assignment_cleanup', seconds: 0.2 },
]

export type SyncSequenceOutcome = 'success' | 'failed'

export interface SyncSequenceRun {
  /** True from the press until the cutover, and true again after a reload mid-run. */
  isRunning: boolean
  /** 0–1, derived from where the chain is and how long the running job has been going. */
  progress: number
  /** Seconds still to go, on the measured averages. */
  remainingSeconds: number
  /** Arm the detector. Call it alongside the POST that starts the chain. */
  start: () => void
  /** Drop an armed run without announcing anything — for a POST that failed. */
  abandon: () => void
}

/**
 * How long to keep forcing polling after a press that never produces a running
 * job. Bounds the forced polling; expiring is silent, because nothing happened.
 */
const ARMING_TIMEOUT_MS = 60_000

/**
 * How long a run may sit with no chain job running and no terminal end_time
 * before it is abandoned. Only a server restart mid-chain gets here — the real
 * gaps between sequential jobs are sub-second.
 */
const STALL_TIMEOUT_MS = 120_000

function jobStatus(
  status: SyncStatusResponse | null | undefined,
  service: string
): SyncStatus | undefined {
  if (!status) return undefined
  return (status as unknown as Record<string, SyncStatus | undefined>)[service]
}

/**
 * True when the orchestrator is running one of its OWN sequences. Those run the
 * same services, so without this a 3 a.m. daily sync would render as an
 * operator's refresh. `_current_run` is present for exactly the four run types
 * `GetCurrentRunProgress` knows about, which is every one except
 * `RunSyncSequence`.
 */
function orchestratorRunInFlight(status: SyncStatusResponse | null | undefined): boolean {
  if (!status) return false
  return (
    status._current_run !== undefined ||
    (status._daily_sync_running ?? false) ||
    (status._weekly_sync_running ?? false) ||
    (status._historical_sync_running ?? false)
  )
}

export function useSyncSequenceRun({
  chain,
  enabled = true,
  onComplete,
}: {
  chain: readonly SyncSequenceJob[]
  /**
   * Gate for the protected read. Pass `permission && !authLoading` — see
   * frontend/CLAUDE.md, "useAuth().isLoading first"; `useSyncStatusAPI` folds
   * the auth half in itself, so a permission flag is enough here.
   */
  enabled?: boolean
  onComplete?: (outcome: SyncSequenceOutcome) => void
}): SyncSequenceRun {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'arming' | 'running'>('idle')

  // ⚠️ READING `dataUpdatedAt` HERE IS NOT FREE. React Query hands `useQuery`'s
  // result through a tracking Proxy (`QueryObserver#trackResult`), so every key
  // this line touches joins `#trackedProps` — and the observer is thereafter
  // notified whenever THAT key changes, not only when `data` does.
  // `dataUpdatedAt` is a fresh `Date.now()` on every resolved fetch, so this
  // observer is now notified on every poll, including the polls whose payload
  // is byte-identical to the one before.
  //
  // MEASURED against the installed query-core 5.101.4 — one observer, 15
  // identical refetches 3 s apart: `const { data }` re-rendered ONCE,
  // `const { data, dataUpdatedAt }` re-rendered FIFTEEN times. `AppLayout`
  // mounts one of these for the whole session, so the price is one render of
  // the app shell per poll for as long as anything is syncing. (`<Outlet/>`
  // hands back the same element from route context, so the routed page below
  // it bails out; it is the nav shell that re-renders, not the board.) Note
  // `#trackedProps` is only ever ADDED to, so this cannot be narrowed by
  // reading the key conditionally — one read arms it for the observer's life.
  //
  // Paid deliberately: the gate below has to notice a refetch that changes
  // NOTHING, and that is precisely the notification tracked props buy. Reading
  // it untracked instead (`queryClient.getQueryState(...)`) leaves the capture
  // to whatever else happens to re-render — the 5 s readout tick, another
  // consumer's state change — which makes the timing incidental rather than
  // prompt, against a ~4.7 s bunking chain and a 60 s arming budget.
  // kindred#2599 tracks the redesign that would remove the need for the read.
  const { data: syncStatus, dataUpdatedAt } = useSyncStatusAPI({
    enabled,
    forcePolling: phase === 'arming',
  })

  // The terminal job's end_time as it stood when this run was first seen.
  // `undefined` means "not captured"; a captured absent end_time is null.
  const baselineRef = useRef<string | null | undefined>(undefined)
  // `dataUpdatedAt` as it stood at the press, and whether the baseline is
  // still waiting on a reading confirmed to POST-DATE it. `start()` cannot
  // snapshot the baseline from the CACHED payload: polling stops entirely
  // while the hook is at rest, so the cache can be arbitrarily old, and an
  // unrelated run's moved `end_time` would then read as our own chain
  // completing before it has done anything (kindred#2595). `dataUpdatedAt` is
  // what makes a genuinely post-press fetch distinguishable from a cached
  // re-render: React Query bumps it on every resolved fetch, even one whose
  // payload is byte-identical to what came before.
  const pressDataUpdatedAtRef = useRef(0)
  const awaitingBaselineRef = useRef(false)
  // The furthest chain job observed running. `RunSyncSequence` aborts on the
  // first error, so at the cutover this is either the terminal job (success) or
  // the job that failed. STATE rather than a ref: the progress readout reads it
  // during render, in the gap between two jobs when nothing is running.
  const [observedIndex, setObservedIndex] = useState(-1)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const terminal = chain[chain.length - 1]
  const terminalEndTime = jobStatus(syncStatus, terminal?.service ?? '')?.end_time ?? null

  const orchestratorBusy = orchestratorRunInFlight(syncStatus)
  let activeIndex = -1
  if (syncStatus && !orchestratorBusy) {
    activeIndex = chain.findIndex((job) => {
      const s = jobStatus(syncStatus, job.service)?.status
      return s === 'running' || s === 'pending'
    })
  }
  const isActive = activeIndex >= 0

  const reset = useCallback(() => {
    baselineRef.current = undefined
    awaitingBaselineRef.current = false
    setObservedIndex(-1)
    setPhase('idle')
  }, [])

  const start = useCallback(() => {
    // Do NOT snapshot from the cached payload — polling stops at rest, so it
    // can be old (kindred#2595). Record the freshness marker instead; the
    // effect below captures the real baseline once a reading that post-dates
    // this press lands.
    baselineRef.current = undefined
    pressDataUpdatedAtRef.current = dataUpdatedAt
    awaitingBaselineRef.current = true
    setObservedIndex(-1)
    setPhase('arming')
    void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
  }, [queryClient, dataUpdatedAt])

  const abandon = useCallback(() => {
    reset()
  }, [reset])

  // The state machine. Deliberately driven by DERIVED SCALARS rather than by
  // the status object: React Query's structural sharing hands back the same
  // object reference when a poll changes nothing, so an object-identity
  // dependency would miss nothing but would also fire on nothing.
  useEffect(() => {
    if (isActive && activeIndex > observedIndex) {
      setObservedIndex(activeIndex)
    }

    if (phase === 'idle') {
      // Picked up mid-run: a reload, a navigation, or a weekend switch. The
      // terminal job has not finished yet, so its current end_time is the right
      // baseline to wait for a change against.
      if (isActive) {
        baselineRef.current = terminalEndTime
        setPhase('running')
      }
      return
    }

    if (isActive) {
      // The press can land before the first status response, leaving `start()`
      // nothing to snapshot. This is the same capture the `idle` branch above
      // makes for a run picked up mid-flight, and it is correct for the same
      // reason: a chain job is running, so the terminal job has NOT finished,
      // and its current end_time is a baseline to wait for a change against —
      // that is true regardless of `dataUpdatedAt` freshness, since an
      // OBSERVED running job is proof enough on its own. Without it
      // `terminalMoved` can never become true and a successful chain ends in a
      // silent stall timeout with no invalidation.
      if (baselineRef.current === undefined) baselineRef.current = terminalEndTime
      awaitingBaselineRef.current = false
      if (phase !== 'running') setPhase('running')
      return
    }

    // Nothing of the chain is currently observed running. Before comparing
    // anything, the baseline itself has to be trustworthy: `start()` could not
    // snapshot it from the cache (kindred#2595), so wait for a reading that
    // POST-DATES the press — confirmed by `dataUpdatedAt` changing, which a
    // refetch bumps even when the payload it returns is unchanged from before.
    // The first such reading is always TRUSTED AS THE BASELINE, never compared
    // against anything: on that read there are no grounds yet to call
    // anything "moved", whether the difference from the pre-press cache is an
    // unrelated run that finished while we were idle, or our own chain
    // finishing between the press and this very first response.
    //
    // `syncStatus &&` is the second half of the same condition, and it is not
    // decoration: `useSyncStatusAPI`'s queryFn SWALLOWS a 401 and returns
    // `null`, which React Query stamps a fresh `dataUpdatedAt` for like any
    // other successful fetch. A reading that post-dates the press is therefore
    // not necessarily a reading that SAYS anything — and capturing `null` as
    // the baseline would make the next reading that does carry data differ
    // from it, i.e. read as our chain completing. `start()` used to carry this
    // guard as `syncStatus ? terminalEndTime : undefined`; it moves with the
    // capture.
    if (awaitingBaselineRef.current) {
      if (syncStatus && dataUpdatedAt !== pressDataUpdatedAtRef.current) {
        baselineRef.current = terminalEndTime
        awaitingBaselineRef.current = false
      }
      return
    }

    // Either the run is over, or this poll landed in the gap between two of
    // its jobs.
    const baseline = baselineRef.current
    const terminalMoved = baseline !== undefined && terminalEndTime !== baseline
    const lastSeen = observedIndex
    const lastSeenFailed =
      lastSeen >= 0 && jobStatus(syncStatus, chain[lastSeen]?.service ?? '')?.status === 'failed'

    if (terminalMoved || lastSeenFailed) {
      const outcome: SyncSequenceOutcome = lastSeenFailed ? 'failed' : 'success'
      reset()
      onCompleteRef.current?.(outcome)
    }
    // Otherwise: still running, between jobs. Hold the running state.
  }, [
    phase,
    isActive,
    activeIndex,
    observedIndex,
    terminalEndTime,
    syncStatus,
    chain,
    reset,
    dataUpdatedAt,
  ])

  // Bound the two states that can otherwise wait forever: an armed press whose
  // chain never starts, and a run whose server died between jobs. Both expire
  // silently — nothing landed, so there is nothing to announce.
  useEffect(() => {
    if (phase === 'idle') return
    if (isActive) return
    const timeout = phase === 'arming' ? ARMING_TIMEOUT_MS : STALL_TIMEOUT_MS
    const timer = setTimeout(reset, timeout)
    return () => clearTimeout(timer)
  }, [phase, isActive, reset])

  // A TICK OF ITS OWN. `person_custom_values_family_camp` runs 536.7 s and its
  // status payload is identical for the whole of it — `Status.Summary` is
  // written only at completion — so React Query's structural sharing hands this
  // observer the SAME `data` reference on every poll of those nine minutes.
  // Without a tick the readout would not merely sit still: it would sit on the
  // value it had when that job STARTED, "about 14 min left" with four minutes
  // to go. This re-renders; it starts no network request.
  //
  // ⚠️ The measurement this comment used to cite — "15 identical polls, ZERO
  // extra renders" — was true of `const { data } = useSyncStatusAPI(...)` and
  // is NO LONGER true of this hook: tracking `dataUpdatedAt` (see the note at
  // the destructure above) means an identical poll now does notify, so the
  // readout would advance on the 3 s poll even without this. The tick STAYS
  // anyway, and not out of caution: it is the only thing that moves when
  // polling itself is not running, and it is what keeps the readout honest if
  // the freshness gate above is ever changed to read `dataUpdatedAt` without
  // tracking it. `advances the remaining-time estimate while the status
  // payload is unchanged` pins it directly, with the query layer mocked out.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (phase === 'idle') return
    const timer = setInterval(() => setTick((t) => t + 1), 5000)
    return () => clearInterval(timer)
  }, [phase])

  const totalSeconds = chain.reduce((sum, job) => sum + job.seconds, 0)
  let doneSeconds = 0
  if (isActive) {
    doneSeconds = chain.slice(0, activeIndex).reduce((sum, job) => sum + job.seconds, 0)
    const startedAt = jobStatus(syncStatus, chain[activeIndex]?.service ?? '')?.start_time
    const current = chain[activeIndex]?.seconds ?? 0
    if (startedAt !== undefined) {
      const elapsed = (Date.now() - Date.parse(startedAt)) / 1000
      doneSeconds += Math.min(Math.max(elapsed, 0), current)
    }
  } else if (phase === 'running' && observedIndex >= 0) {
    doneSeconds = chain.slice(0, observedIndex + 1).reduce((sum, job) => sum + job.seconds, 0)
  }

  return {
    isRunning: phase !== 'idle',
    progress: totalSeconds > 0 ? Math.min(1, Math.max(0, doneSeconds / totalSeconds)) : 0,
    remainingSeconds: Math.max(0, totalSeconds - doneSeconds),
    start,
    abandon,
  }
}
