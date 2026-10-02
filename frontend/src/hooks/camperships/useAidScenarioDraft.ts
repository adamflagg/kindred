import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  NO_PENDING,
  hasPending,
  sizingDocument,
  unmoved,
  type Pending,
} from '../../components/camperships/season/scenarios/scenarioModel'
import {
  evaluateAidScenario,
  freezeAidScenarioSeason,
  keepAidScenario,
  loadAidScenarioDraft,
  saveAidScenarioDraft,
  startAidScenarios,
} from '../../services/camperships/aidApi'
import type {
  ApiAidRulesDocumentIn,
  ApiAidScenarioDraft,
  ApiAidScenarioResults,
  ApiAidScenarioWorkspace,
} from '../../types/api-types'
import { invalidateAidScenarioQueries, queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

/** The figures while a slider moves: priced on the frozen season, never recorded (`evaluate`). */
export type LiveResults =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly results: ApiAidScenarioResults }
  | { readonly status: 'error'; readonly error: string }

/** About one season pricing per call: wait for the slider to pause before asking. */
const DEBOUNCE_MS = 300

const message = (caught: unknown, fallback: string) =>
  caught instanceof Error && caught.message !== '' ? caught.message : fallback

/**
 * Your scenario draft at work (spec §7.4; D37, D38; Decision 19):
 * - a slider or box moves `pending`, and the figures follow live (`evaluate`, debounced, the newest
 *   answer wins), recording nothing;
 * - letting go (`release`) prices the draft with what moved and records it in the trail (`evaluate`,
 *   then `PUT /draft` with the document it returned): one trail row per release, not per pixel;
 * - every write (release, load, keep, freeze, start) runs one after another, in the order asked, so a
 *   load clicked while a box still holds typing waits for that typing to be recorded first;
 * - while a write runs, `busy` names it and the sliders stand still: what they show is always what
 *   the next write will record.
 */
export function useAidScenarioDraft(workspace: ApiAidScenarioWorkspace | undefined) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Pending>(NO_PENDING)
  const [live, setLive] = useState<LiveResults>({ status: 'idle' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The last freeze found the season as frozen: nothing new to freeze (cleared by the next write). */
  const [nothingToFreeze, setNothingToFreeze] = useState(false)
  const pendingRef = useRef<Pending>(NO_PENDING)
  const draftRef = useRef<ApiAidScenarioDraft | null>(workspace?.draft ?? null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    draftRef.current = workspace?.draft ?? null
  }, [workspace?.draft])
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
    },
    []
  )

  const stopLive = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    inFlight.current?.abort()
    setLive({ status: 'idle' })
  }, [])

  /** A slider or box moved: the figures follow, nothing is recorded. */
  const move = useCallback(
    (patch: Partial<Pending>) => {
      const draft = draftRef.current
      // A setting moved back to the draft's own value is not moved: nothing to price or record.
      const merged = { ...pendingRef.current, ...patch }
      const next = draft === null ? merged : unmoved(merged, draft.document)
      pendingRef.current = next
      setPending(next)
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
      if (!hasPending(next) || draft === null) {
        setLive({ status: 'idle' })
        return
      }
      setLive({ status: 'loading' })
      timer.current = setTimeout(() => {
        const controller = new AbortController()
        inFlight.current = controller
        evaluateAidScenario(
          fetchWithAuth,
          year,
          {
            document: sizingDocument(draft.document, next),
            tier_shift: next.tierShift,
            band_width_delta: next.bandDelta,
          },
          controller.signal
        )
          .then((out) => {
            if (!controller.signal.aborted) setLive({ status: 'ready', results: out.results })
          })
          .catch((caught: unknown) => {
            if (!controller.signal.aborted) {
              setLive({ status: 'error', error: message(caught, "Couldn't work out the scenario") })
            }
          })
      }, DEBOUNCE_MS)
    },
    [fetchWithAuth, year]
  )

  /**
   * One write after the last. Resolves true when the write landed, false when it was refused (its
   * words are in `error`). The scenario reads refresh before `busy` clears, so a button never comes
   * back while the page still shows the state from before the write. `idle`, asked when the write's
   * turn comes, skips a write with nothing to do (a slider's no-op release): it names no `busy`,
   * clears no `error` still on screen and refreshes nothing. A failing refresh can never stop later
   * writes.
   */
  const run = useCallback(
    (label: string, write: () => Promise<void>, idle?: () => boolean): Promise<boolean> => {
      const done = chain.current.then(async () => {
        if (idle?.() === true) return true
        setBusy(label)
        setError(null)
        setNothingToFreeze(false)
        let landed = true
        try {
          await write()
        } catch (caught) {
          setError(message(caught, "Couldn't do that"))
          landed = false
        }
        try {
          await invalidateAidScenarioQueries(queryClient)
        } catch {
          // the refetch is a refresh, not part of the write: the chain must keep going
        }
        setBusy(null)
        return landed
      })
      chain.current = done.then(() => undefined)
      return done
    },
    [queryClient]
  )

  /** Put a draft the server returned straight into the workspace, so the figures don't flicker back. */
  const settleDraft = useCallback(
    (draft: ApiAidScenarioDraft) => {
      draftRef.current = draft
      queryClient.setQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(year), (old) =>
        old === undefined ? old : { ...old, draft }
      )
    },
    [queryClient, year]
  )

  const clearPending = useCallback(() => {
    pendingRef.current = NO_PENDING
    setPending(NO_PENDING)
    stopLive()
  }, [stopLive])

  /** Let go of what moved: priced and recorded in the trail (D38). Nothing moved, nothing recorded. */
  const release = useCallback(
    () =>
      run(
        'Recording…',
        async () => {
          const moved = pendingRef.current
          const draft = draftRef.current
          if (draft === null) throw new Error('Load a kept option into your draft first')
          // This release prices the season itself: a live pricing still waiting would be a second one.
          if (timer.current !== null) clearTimeout(timer.current)
          inFlight.current?.abort()
          try {
            const evaluated = await evaluateAidScenario(fetchWithAuth, year, {
              document: sizingDocument(draft.document, moved),
              tier_shift: moved.tierShift,
              band_width_delta: moved.bandDelta,
            })
            settleDraft(
              await saveAidScenarioDraft(fetchWithAuth, year, { document: evaluated.document })
            )
            clearPending()
          } catch (caught) {
            // Refused: the moves are still on screen, so their figures follow again.
            move({})
            throw caught
          }
        },
        // Nothing moved, nothing recorded: a key-up or a blur that moved nothing leaves the page be.
        () => !hasPending(pendingRef.current)
      ),
    [run, fetchWithAuth, year, settleDraft, clearPending, move]
  )

  /** A kept option or a trail row into the draft; recorded, so loading never asks "discard?" (D38). */
  const load = useCallback(
    (from: { option: string } | { trail_row: string }) =>
      run('Loading…', async () => {
        settleDraft(await loadAidScenarioDraft(fetchWithAuth, year, from))
        clearPending()
      }),
    [run, fetchWithAuth, year, settleDraft, clearPending]
  )

  /** Keep the recorded draft: a variant under its starting point, or a new starting point (D38). */
  const keep = useCallback(
    (startingPoint: boolean) =>
      run('Keeping…', async () => {
        await keepAidScenario(fetchWithAuth, year, { starting_point: startingPoint })
      }),
    [run, fetchWithAuth, year]
  )

  /** Record a whole document as the draft: a fit's answer, or a section edited under "All settings". */
  const adopt = useCallback(
    (document: ApiAidRulesDocumentIn) =>
      run('Recording…', async () => {
        settleDraft(await saveAidScenarioDraft(fetchWithAuth, year, { document }))
        clearPending()
      }),
    [run, fetchWithAuth, year, settleDraft, clearPending]
  )

  const freeze = useCallback(
    () =>
      run('Freezing the applications…', async () => {
        const before = queryClient.getQueryData<ApiAidScenarioWorkspace>(
          queryKeys.aidScenarios(year)
        )?.snapshot
        const frozen = await freezeAidScenarioSeason(fetchWithAuth, year)
        // The server hands back the snapshot it already had when the season hasn't moved.
        if (before?.id !== undefined && frozen.id === before.id) {
          setNothingToFreeze(true)
          return
        }
        // Moves still on screen were priced on the snapshot this replaced.
        if (hasPending(pendingRef.current)) move({})
      }),
    [run, fetchWithAuth, year, move, queryClient]
  )

  const start = useCallback(
    (from: 'rules' | 'last_season') =>
      run('Starting…', async () => {
        // Starting replaces the draft: settle the workspace it returns, as a load settles its draft.
        const started = await startAidScenarios(fetchWithAuth, year, from)
        draftRef.current = started.draft ?? null
        queryClient.setQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(year), started)
        clearPending()
      }),
    [run, fetchWithAuth, year, queryClient, clearPending]
  )

  return {
    pending,
    live,
    busy,
    error,
    nothingToFreeze,
    move,
    release,
    load,
    keep,
    adopt,
    freeze,
    start,
  }
}
