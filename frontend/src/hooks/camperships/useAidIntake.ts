import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidAidOnNoRequest,
  fetchAidIntakeForms,
  fetchAidIntakeSummary,
  fetchAidIntakeUnlisted,
} from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Requests › Form intake's reads (PR 3; spec 71 §2.4), `view` only, live only. They inherit the app's cache defaults:
 * every aid write clears the intake prefix (`invalidateAidMoneyQueries`, Add a Request…, Mark Reviewed and Remove…
 * included) and a sync completion clears the 'financial-aid' prefix.
 */
function useIntakeGate(): { year: number; enabled: boolean } {
  const year = useYear()
  const { isLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return {
    year,
    enabled: year > 0 && !isLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  }
}

/** Every row for the season (the page; Season's line reads it too, for the registration ask beside a line). */
export function useAidIntakeForms({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const { year, enabled: allowed } = useIntakeGate()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidIntakeForms(year),
    queryFn: () => fetchAidIntakeForms(fetchWithAuth, year),
    enabled: enabled && allowed,
  })
}

/** The Requests band link's count (owner Q1-A). */
export function useAidIntakeSummary() {
  const { year, enabled } = useIntakeGate()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidIntakeSummary(year),
    queryFn: () => fetchAidIntakeSummary(fetchWithAuth, year),
    enabled,
  })
}

/** Season's line opened in place (owner Q4-A): read only while it is open. */
export function useAidAidOnNoRequest(open: boolean) {
  const { year, enabled } = useIntakeGate()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidIntakeAidOnNoRequest(year),
    queryFn: () => fetchAidAidOnNoRequest(fetchWithAuth, year),
    enabled: enabled && open,
  })
}

/** The fewest characters Find a Camper Not Listed… searches on (the server answers none under it). */
export const UNLISTED_MIN = 2

/** Find a Camper Not Listed…'s search: the typed words, trimmed; nothing under two characters. */
export function useAidIntakeUnlisted(query: string) {
  const { year, enabled } = useIntakeGate()
  const { fetchWithAuth } = useApiWithAuth()
  const q = query.trim()
  return useQuery({
    queryKey: queryKeys.aidIntakeUnlisted(year, q),
    queryFn: () => fetchAidIntakeUnlisted(fetchWithAuth, year, q),
    enabled: enabled && q.length >= UNLISTED_MIN,
  })
}
