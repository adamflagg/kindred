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
 * ## Where the baseline comes from, and why not from the cache
 *
 * A run picked up mid-flight snapshots it the moment a chain job is seen
 * running: the terminal job has demonstrably NOT finished, so whatever it says
 * now is a value to wait for a change against. A PRESS has no such proof.
 * `start()` cannot read the cache either — polling stops entirely while the
 * hook is at rest, so the cached payload can be arbitrarily old, and an
 * unrelated run's moved `end_time` would then read as our own chain completing
 * before it had done anything (kindred#2595).
 *
 * So the press waits for a reading it KNOWS post-dates it, and takes that as
 * the baseline. `queryClient.invalidateQueries()` returns a promise that
 * resolves when the refetch it triggered has settled, which is exactly that
 * reading (kindred#2599). Two things about that promise are not free, and are
 * guarded where it is awaited: it resolves without fetching anything when no
 * observer is active, and it can be deduplicated onto a fetch that predates
 * the press.
 *
 * ⛔ WHAT THIS DOES NOT DO, under any mechanism: detect a chain that finishes
 * BEFORE that first post-press reading. "An unrelated run moved the terminal
 * `end_time` while we were idle" and "our own chain finished between the press
 * and the first response" are observationally identical on the inputs the
 * client has, and the fresh reading is the baseline under either. The first
 * post-press reading is therefore always trusted, never compared.
 *
 * ## No new polling code
 *
 * `useSyncStatusAPI` already polls every 3 s while anything reports
 * running/pending and stops entirely at rest, and already sets
 * `refetchOnWindowFocus`. This hook subscribes to that same query — React Query
 * shares one cache entry across observers — and asks it for `forcePolling` for
 * the WHOLE of a run, not merely for the arming gap.
 *
 * The arming gap is the obvious half: the few hundred milliseconds between the
 * POST returning `{"status":"started"}` and the first job being marked running,
 * when nothing reports running and the polling would otherwise never start. The
 * other half is every GAP BETWEEN TWO SEQUENTIAL JOBS. `runSyncAndWait` waits on
 * a 500 ms ticker, and a `RunSyncSequence` carries no run-type flag and takes no
 * queue entry, so a poll landing in one reads a payload that reports NOTHING —
 * `refetchInterval` returns `false` and React Query clears the interval. Only a
 * window focus would ever start it again, so the rest of the chain runs
 * unobserved: no cutover, no invalidation, and the stall timeout retiring the
 * run in silence two minutes later. That is the staleness kindred#2587 is
 * about, under a progress bar that has simply vanished.
 *
 * Holding it for the whole run costs nothing extra: wherever a chain job IS
 * published as running, `refetchInterval` already returns 3000, so those gaps
 * are the entire delta. And it cannot latch on, because every exit — the
 * cutover, `abandon()`, the arming timeout, the stall timeout — goes through
 * `reset()`, which puts the phase back to `idle` and drops the force with it.
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
  /**
   * Arm the detector. Call it alongside the POST that starts the chain.
   *
   * The arming itself is SYNCHRONOUS; the promise settles once the ATTEMPT to
   * capture a baseline has finished — which is not the same as having captured
   * one. Three of its four exit paths capture nothing: a second press has
   * replaced this one, the invalidation resolved without fetching, or the
   * reading carried no payload. So awaiting this is not a guarantee that a
   * baseline is in hand; what it guarantees is that nothing further will be
   * attempted for this run. That degradation is the documented safe one — a
   * chain that starts is caught by the observed-running capture instead, and
   * one that never starts expires on the arming timeout.
   *
   * Callers are free to ignore it (`void run.start()`) or to await it before
   * firing the POST.
   */
  start: () => Promise<void>
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

  // ⚠️ `data` AND NOTHING ELSE. React Query hands `useQuery`'s result through a
  // tracking Proxy (`QueryObserver#trackResult`), so every key this line reads
  // joins `#trackedProps` — and the observer is thereafter notified whenever
  // THAT key changes, not only when `data` does. `dataUpdatedAt` is a fresh
  // `Date.now()` on every resolved fetch, so reading it here would notify this
  // observer on every poll, including the polls whose payload is byte-identical
  // to the one before.
  //
  // MEASURED against the installed query-core 5.101.4 — one observer, 15
  // identical refetches 3 s apart: `const { data }` re-rendered ONCE,
  // `const { data, dataUpdatedAt }` re-rendered FIFTEEN times. `AppLayout`
  // mounts one of these for the whole session, so that would be one render of
  // the nav shell per poll for as long as anything is syncing — a nightly daily
  // sync included, when no run is armed at all. `#trackedProps` is only ever
  // ADDED to, so it cannot be narrowed by reading the key conditionally: one
  // read arms it for the observer's life.
  //
  // `start()` gets its freshness signal from `invalidateQueries`' own promise
  // instead (kindred#2599), and the one fetch-counting thing it still looks at
  // it reads through `queryClient.getQueryState(...)` — UNTRACKED, and so free.
  const { data: syncStatus } = useSyncStatusAPI({
    enabled,
    // EVERY phase but `idle`, not just `arming`: the arming gap and the
    // sub-second gaps between sequential jobs are both polls that read a
    // payload reporting nothing, and either one would otherwise stop the
    // polling dead. See "No new polling code" above.
    forcePolling: phase !== 'idle',
  })

  // The terminal job's end_time as it stood when this run was first seen.
  // `undefined` means "not captured", and is the whole of the state machine's
  // "no grounds to call anything moved yet"; a captured absent end_time is
  // null. Nothing else encodes that bit — the `awaitingBaseline` flag that used
  // to sit beside it was true in exactly the cases this is `undefined` in.
  const baselineRef = useRef<string | null | undefined>(undefined)
  // Which run a resolving `start()` belongs to. Its baseline capture happens
  // after two awaits, and an `abandon()`, a cutover or a second press in
  // between must not let a stale promise write over what the current run has
  // set up.
  const runTokenRef = useRef(0)
  // The furthest chain job observed running. `RunSyncSequence` aborts on the
  // first error, so at the cutover this is either the terminal job (success) or
  // the job that failed. STATE rather than a ref: the progress readout reads it
  // during render, in the gap between two jobs when nothing is running.
  const [observedIndex, setObservedIndex] = useState(-1)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const terminalService = chain[chain.length - 1]?.service ?? ''
  const terminalEndTime = jobStatus(syncStatus, terminalService)?.end_time ?? null

  const orchestratorBusy = orchestratorRunInFlight(syncStatus)
  let activeIndex = -1
  if (syncStatus && !orchestratorBusy) {
    activeIndex = chain.findIndex((job) => {
      const s = jobStatus(syncStatus, job.service)?.status
      return s === 'running' || s === 'pending'
    })
  }
  const isActive = activeIndex >= 0

  /**
   * Take the baseline unless this run already has one. NEVER OVERWRITE: a
   * baseline captured from an OBSERVED running job is proof on its own, and is
   * older than anything a later reading could offer.
   */
  const captureBaseline = useCallback((endTime: string | null) => {
    if (baselineRef.current === undefined) baselineRef.current = endTime
  }, [])

  const reset = useCallback(() => {
    runTokenRef.current += 1
    baselineRef.current = undefined
    setObservedIndex(-1)
    setPhase('idle')
  }, [])

  const start = useCallback(async () => {
    // ARMED SYNCHRONOUSLY, above the first `await`: all of this has run by the
    // time `start()` hands a promise back, so the POST on the caller's next
    // line cannot outrun the detector. Awaiting it instead is also safe — that
    // only delays the POST until the baseline is in hand, which narrows the
    // window rather than opening one.
    const token = ++runTokenRef.current
    baselineRef.current = undefined
    setObservedIndex(-1)
    setPhase('arming')

    const key = queryKeys.syncStatus()

    // HAZARD, DEDUPLICATION. `Query#fetch` hands back the EXISTING retryer
    // promise when a fetch is already in flight and the cache holds no data —
    // `cancelRefetch`, which `refetchQueries` already passes, can only cancel a
    // refetch that has something to revert to. The invalidation below would
    // then resolve carrying a payload the server decided BEFORE the press, and
    // an unrelated run that finished in between would be invisible to it.
    // Cancelling first makes "the reading I trust was requested after the
    // press" true by construction, at the cost of one re-issued poll.
    await queryClient.cancelQueries({ queryKey: key })

    const updatesBefore = queryClient.getQueryState(key)?.dataUpdateCount ?? 0
    await queryClient.invalidateQueries({ queryKey: key })
    if (runTokenRef.current !== token) return

    const state = queryClient.getQueryState<SyncStatusResponse | null>(key)

    // HAZARD, A PROMISE THAT RESOLVES WITHOUT FETCHING. `invalidateQueries`
    // hands its filters to `refetchQueries`, which defaults to `type: 'active'`:
    // with no active observer — or no cache entry at all — it matches nothing
    // and resolves IMMEDIATELY, having fetched nothing. Reading the cache back
    // at that point hands over the arbitrarily old payload kindred#2595 is
    // about, with nothing to say it is old. `dataUpdateCount` is the proof that
    // a fetch actually landed. Leaving the baseline uncaptured when it has not
    // is the safe degradation: a chain that does start is still caught by the
    // OBSERVED-running capture below, and one that never starts still expires
    // on the arming timeout.
    if (!state || state.dataUpdateCount === updatesBefore) return

    // A reading that post-dates the press is not the same thing as a reading
    // that SAYS anything: `useSyncStatusAPI`'s queryFn SWALLOWS a 401 and
    // returns `null`, which React Query stamps as a perfectly successful fetch.
    // Capturing `null` as the baseline would make the next reading that does
    // carry data differ from it — i.e. read as our chain completing. One shot
    // is enough: on a 401 `pb.afterSend` has already cleared auth and redirected
    // to /login, so there is no session left to announce into.
    const fresh = state.data
    if (!fresh) return

    captureBaseline(jobStatus(fresh, terminalService)?.end_time ?? null)
  }, [queryClient, terminalService, captureBaseline])

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
      // The reading `start()` awaited can arrive carrying nothing — a press
      // before the first status response, a 401, an invalidation that fetched
      // nothing — leaving the baseline uncaptured. This is the same capture the
      // `idle` branch above makes for a run picked up mid-flight, and it is
      // correct for the same reason: a chain job is RUNNING, so the terminal
      // job has NOT finished, and its current end_time is a value to wait for a
      // change against. An OBSERVED running job is proof on its own and needs
      // no freshness argument at all. Without this `terminalMoved` could never
      // become true and a successful chain would end in a silent stall timeout
      // with no invalidation.
      captureBaseline(terminalEndTime)
      if (phase !== 'running') setPhase('running')
      return
    }

    // Nothing of the chain is currently observed running: either the run is
    // over, or this poll landed in the gap between two of its jobs.
    //
    // Nothing may be called "moved" without a baseline to move against, and an
    // armed press has one only once the reading `start()` awaited has landed
    // AND been trusted (kindred#2595, kindred#2599). Until then this is the
    // whole of the answer: no grounds yet. That is deliberately the same
    // silence whether the difference from the pre-press cache would have been
    // an unrelated run finishing while we were idle or our own chain finishing
    // between the press and that first response — the two are not separable on
    // the data, and the run stays BOUNDED by the arming timeout either way.
    const baseline = baselineRef.current
    if (baseline === undefined) return

    // A reading that arrives is not necessarily a reading that SAYS anything:
    // `useSyncStatusAPI`'s queryFn SWALLOWS a 401 and returns `null`, which
    // React Query treats as a perfectly successful fetch. Comparing against
    // that would read every string baseline as having moved to nothing — i.e.
    // as our chain completing. `start()` carries the same guard for the
    // capture; this is it for the comparison.
    if (!syncStatus) return

    const terminalMoved = terminalEndTime !== baseline
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
    captureBaseline,
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
  // ⚠️ That measurement — "15 identical polls, ZERO extra renders" — is true of
  // this hook again since kindred#2599. It was NOT true while the freshness
  // gate read `dataUpdatedAt`, which tracked that key and so did notify on an
  // identical poll; the baseline now comes from `invalidateQueries`' own
  // promise (see the destructure above), nothing puts a per-fetch timestamp
  // into `#trackedProps`, and the tick is once more the ONLY thing that moves
  // the readout during those nine minutes. It stays regardless of what the gate
  // is built on, because it is also the only thing that moves when polling
  // itself is not running. `advances the remaining-time estimate while the
  // status payload is unchanged` pins it directly, with the query layer mocked
  // out.
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
