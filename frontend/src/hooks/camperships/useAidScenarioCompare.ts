import { useQuery } from '@tanstack/react-query'

import {
  fetchAidScenarioCompare,
  fetchAidScenarioTrail,
  retryUnlessRefused,
  type AidRequestSet,
} from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

/** A refusal in the server's words answers at once. */
const retry = retryUnlessRefused([404, 422])

const setKey = (set: AidRequestSet) => (set.kind === 'date' ? `date:${set.date}` : set.kind)

/**
 * The compare (spec §7.4; D38, D138; RPT-17, RPT-32). Enabled by the tab once a draft exists (a
 * compare always starts with your draft). A refusal in the server's words (no deadline in the
 * approved milestones for the deadline switch) answers at once.
 */
export function useAidScenarioCompare(
  codes: readonly string[],
  requestSet: AidRequestSet,
  lastSeason: boolean,
  { enabled = true }: { readonly enabled?: boolean } = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidScenarioCompare(year, codes.join(','), setKey(requestSet), lastSeason),
    queryFn: () => fetchAidScenarioCompare(fetchWithAuth, year, codes, requestSet, lastSeason),
    enabled: enabled && year > 0,
    retry,
  })
}

/** The trail, newest first, a page of 50 at a time (D38). */
export function useAidScenarioTrail(
  page: number,
  { enabled = true }: { readonly enabled?: boolean } = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidScenarioTrail(year, page),
    queryFn: () => fetchAidScenarioTrail(fetchWithAuth, year, page),
    enabled: enabled && year > 0,
  })
}
