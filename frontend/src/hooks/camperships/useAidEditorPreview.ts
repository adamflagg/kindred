import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  toEditorPreview,
  type PreviewHousehold,
} from '../../components/camperships/kit/editorPreview'
import type { EditorPreview } from '../../components/camperships/kit/RequestEditor'
import { previewAidEdit } from '../../services/camperships/aidApi'
import type { FetchWithAuth } from '../../services/lodgingApi'
import type { ApiAidPreview } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'

/** About one season read per call (#2924 Decision 13), so typing pauses before it asks. */
const DEBOUNCE_MS = 300

/**
 * The preview of the amount an editor opens on, as one cached read (R2, owner ruling 10-05). Keyed
 * under the household page, so the write that refreshes the page drops it too; the app's cache
 * defaults apply otherwise. A refusal is said at once, never retried.
 */
function openingPreview(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  round: 2 | 3,
  amount: number
) {
  return {
    queryKey: queryKeys.aidPreview(requestId, round, amount),
    // No abort signal: a card that unmounts (StrictMode's dev remount, a tab switch) would cancel
    // and re-ask a read worth one season read; its answer is cheap to keep instead.
    queryFn: () => previewAidEdit(fetchWithAuth, requestId, { round, amount }),
    retry: false,
  } as const
}

/** A cached preview still fresh by the app's rule (not invalidated, inside its staleTime). */
function freshPreview(
  queryClient: QueryClient,
  requestId: string,
  round: 2 | 3,
  amount: number
): ApiAidPreview | undefined {
  const queryKey = queryKeys.aidPreview(requestId, round, amount)
  const query = queryClient.getQueryCache().find<ApiAidPreview>({ queryKey, exact: true })
  const { staleTime } = queryClient.defaultQueryOptions({ queryKey })
  if (query === undefined || typeof staleTime === 'function') return undefined
  return query.isStaleByTime(staleTime) ? undefined : query.state.data
}

/**
 * The card's prefetch (R2): a card whose money editor would open on an amount reads that amount's
 * preview while it rests, so opening the editor shows the line at once. Pass null for a card whose
 * editor would open empty, and it asks nothing. It follows the household page: a write that
 * refreshes the page refreshes it too.
 */
export function usePrefetchAidPreview(
  requestId: string,
  round: 2 | 3,
  amount: number | null
): void {
  const { fetchWithAuth } = useApiWithAuth()
  useQuery({
    ...openingPreview(fetchWithAuth, requestId, round, amount ?? 0),
    enabled: amount !== null,
    // Nothing on the card draws it; the editor reads it from the cache.
    notifyOnChangeProps: [],
  })
}

/**
 * The editor's line while typing (§4.6; D22): a debounced POST /requests/{id}/preview, never cached
 * (a POST). A newer amount cancels the older call, so a slow answer never overwrites a newer one.
 * State changes only in the handler and in the call's own answer, never in an effect.
 *
 * `openOn` (R2, owner ruling 10-05): the amount the editor opens on is asked at once, with no
 * debounce, through the cache, so a card that prefetched it shows the line from the first paint
 * and asks nothing more. Typing still debounces, and a typed amount wins over the opening answer.
 * The Requests grid passes none: it never previews at open.
 */
export function useAidEditorPreview(
  requestId: string,
  round: 2 | 3,
  householdOf: (householdCmId: number) => PreviewHousehold,
  openOn: number | null = null
): { preview: EditorPreview; onAmountChange: (amount: number | null) => void } {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<EditorPreview>(() => {
    if (openOn === null) return { status: 'idle' }
    const cached = freshPreview(queryClient, requestId, round, openOn)
    return cached === undefined ? { status: 'loading' } : toEditorPreview(cached, householdOf)
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<AbortController | null>(null)
  const householdRef = useRef(householdOf)
  useEffect(() => {
    householdRef.current = householdOf
  })
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
    },
    []
  )

  const answer = useCallback((controller: AbortController, call: Promise<ApiAidPreview>) => {
    void call
      .then((out) => {
        if (!controller.signal.aborted) setPreview(toEditorPreview(out, householdRef.current))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPreview({
          status: 'error',
          error: error instanceof Error ? error.message : "Couldn't work out the award",
        })
      })
  }, [])

  // Once per open: the amount it opened on, unless the first paint already had it from the cache.
  // The cache call is shared with a prefetch still on its way; leaving only stops listening for it.
  const opened = useRef(openOn)
  useEffect(() => {
    const amount = opened.current
    if (amount === null || freshPreview(queryClient, requestId, round, amount) !== undefined) return
    const controller = new AbortController()
    inFlight.current = controller
    answer(
      controller,
      queryClient.fetchQuery(openingPreview(fetchWithAuth, requestId, round, amount))
    )
  }, [answer, fetchWithAuth, queryClient, requestId, round])

  const onAmountChange = useCallback(
    (amount: number | null) => {
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
      if (amount === null) {
        setPreview({ status: 'idle' })
        return
      }
      setPreview({ status: 'loading' })
      timer.current = setTimeout(() => {
        const controller = new AbortController()
        inFlight.current = controller
        answer(
          controller,
          previewAidEdit(fetchWithAuth, requestId, { round, amount }, controller.signal)
        )
      }, DEBOUNCE_MS)
    },
    [answer, fetchWithAuth, requestId, round]
  )

  return { preview, onAmountChange }
}
