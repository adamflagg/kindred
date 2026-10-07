import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  compareKey,
  fetchAidScenarioCompare,
  retryUnlessRefused,
  type CompareQuery,
} from '../../services/camperships/aidApi'
import { useAuth } from '../../contexts/AuthContext'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

/** A refusal in the server's words answers at once. */
const retry = retryUnlessRefused([404, 422])

/**
 * The compare (spec §7.4; D38, D138; RPT-17, RPT-32). Waits for auth to settle; the rules permission (finance only, D76) is the caller's gate, so the tab
 * passes it in `enabled` (Task 20). Enabled by the tab once a draft exists (a
 * compare always starts with your draft). A refusal in the server's words (no deadline in the
 * approved milestones for the deadline switch) answers at once.
 */
export function useAidScenarioCompare(
  query: CompareQuery,
  { enabled = true }: { readonly enabled?: boolean } = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  return useQuery({
    queryKey: queryKeys.aidScenarioCompare(year, compareKey(query)),
    queryFn: () => fetchAidScenarioCompare(fetchWithAuth, year, query),
    enabled: enabled && year > 0 && !authLoading,
    retry,
    // A tick or a request-set change keeps the last table on screen, marked stale, rather than a spinner.
    placeholderData: keepPreviousData,
  })
}
