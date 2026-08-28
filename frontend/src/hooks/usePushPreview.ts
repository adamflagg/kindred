/**
 * The scenario→live write-in comparison (kindred#2477), shared by the two
 * things that need it: the board's "Push write-ins" badge
 * (`PushWriteInsEntry`) and the modal that button opens
 * (`PushWriteInsModal`).
 *
 * ONE hook, one cache slot, two observers. The badge reads the same report
 * the modal renders, so a staff member who opens the modal sees the tiles
 * the badge was already summarising rather than a second, independently
 * fetched answer.
 *
 * ## staleTime 0 is deliberate, and is not the app's caching row being ignored
 *
 * A real divergence from the app's 30 minute default (CLAUDE.md §4's
 * "Family Camp Models Summer" caching row), and it earns it in two places:
 *
 * - The modal STAYS MOUNTED across opens — it is rendered unconditionally
 *   and gated only by `isOpen` — so there is no fresh "mount" for
 *   `refetchOnMount: 'always'` to catch on reopen, only an existing
 *   observer's `enabled` flipping true again. Under the 30 minute default a
 *   reopen would keep serving the FIRST open's cached report until the
 *   digest 409 bounced a stale push, which defeats the point of a "look
 *   right before you act" screen.
 * - The badge is a number staff read at a glance and act on without opening
 *   anything, so it must not be a half-hour old.
 *
 * The other half of CLAUDE.md §4's rule — long staleTime plus explicit
 * invalidation, never short staleTime plus hope — is still honoured for the
 * writes: `invalidateLodgingRegistryQueries` invalidates
 * `queryKeys.pushPreviewPrefix()`, so every write-in edit, merge and unit
 * rename moves this query. `staleTime: 0` is what makes that invalidation
 * refetch immediately rather than on the next mount, and what makes every
 * modal open re-ask.
 *
 * `refetchOnWindowFocus` and `refetchOnReconnect` are both false app-wide
 * (`utils/queryClient.ts`), so a permanently-mounted observer at
 * `staleTime: 0` costs one fetch per board open plus one per invalidation —
 * not a poll.
 *
 * `PushPreview.digest` remains the correctness backstop regardless:
 * `executeWriteInPush` echoes it back and the server refuses a push made
 * against a report the live board or the scenario has since moved past.
 * Freshness of what staff SEE is this hook; the digest only catches what
 * slips through.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { fetchPushPreview, type PushPreview } from '../services/lodgingApi'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export interface UsePushPreviewOptions {
  year: number
  /** The weekend. The endpoint declares `gt=0`, so a caller with no weekend
   *  selected must pass `enabled: false` rather than a `0`. */
  sessionCmId: number
  /** `''` is the CampMinder mirror, which has nothing to compare against. */
  scenario: string
  enabled: boolean
}

export function usePushPreview({
  year,
  sessionCmId,
  scenario,
  enabled,
}: UsePushPreviewOptions): UseQueryResult<PushPreview> {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<PushPreview>({
    queryKey: queryKeys.pushPreview(year, sessionCmId, scenario),
    queryFn: () => fetchPushPreview(fetchWithAuth, { year, sessionCmId, scenario }),
    enabled: enabled && scenario !== '' && sessionCmId > 0,
    // See the module doc: the mount-based option alone cannot keep either
    // caller current.
    staleTime: 0,
    refetchOnMount: 'always',
  })
}
