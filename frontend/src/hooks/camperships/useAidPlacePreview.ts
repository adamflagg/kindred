import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { previewAidPlacement } from '../../services/camperships/aidApi'
import type { ApiAidPlacePreviewIn } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { usePermissions } from '../usePermissions'

/**
 * The parts, in a key's words, sorted by request so the same parts in another order are the same
 * question: "reqemma00000001:2200.00|reqsamuel000002:1420.00".
 */
export const partsKey = (body: ApiAidPlacePreviewIn) =>
  body.parts
    .map((p) => `${p.request_id}:${String(p.amount)}`)
    .sort()
    .join('|')

/**
 * How long a line stays open before its preview is asked, as the split editor waits for typing to
 * pause (review R1-2). Each preview is a full season read, and ↑/↓ opens every row it passes.
 */
export const PREVIEW_SETTLE_MS = 300

/**
 * What placing `body` on one To place line would do right now (slice 3 ask 8, #2975; P-4), asked
 * when a line opens (Confirm's suggestion) or as parts are typed (Split…, part 1b). `null` asks nothing.
 *
 * ⚠ The one place slice 3 departs from the app's cache defaults (CLAUDE.md "Family Camp models
 * summer", caching row): `gcTime: 0`, so an answer lives exactly as long as something on screen reads
 * it. The read behind To place may be half an hour old; this answer exists to say what Confirm would
 * mark posted NOW (§4.10: what you confirm is what's written), so closing the line drops it and the
 * next open asks again. While the line is open the answer is shared (`staleTime: Infinity`): the
 * split editor opening on the suggestion's parts reuses it instead of re-pricing the season (review
 * R1-2). It writes nothing; it sits under the to-place prefix, so every write still refreshes it (an
 * invalidated query refetches whatever its staleTime). A refusal (the line moved, someone placed it)
 * is said at once, never retried. Casework only: the route is `casework`.
 */
export function useAidPlacePreview(
  year: number,
  transactionCmId: number,
  body: ApiAidPlacePreviewIn | null
) {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidPlacePreview(year, transactionCmId, body === null ? '' : partsKey(body)),
    queryFn: () => previewAidPlacement(fetchWithAuth, year, transactionCmId, body ?? { parts: [] }),
    enabled:
      body !== null &&
      body.parts.length > 0 &&
      year > 0 &&
      !authLoading &&
      hasPermission(Permission.FINANCIAL_AID_CASEWORK),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
}
