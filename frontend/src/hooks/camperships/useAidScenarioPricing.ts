import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  evaluateAidScenario,
  requestSetBody,
  retryUnlessRefused,
  setKey,
  type AidRequestSet,
} from '../../services/camperships/aidApi'
import type { ApiAidRulesDocumentIn } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A refusal in the server's words (an evaluate on a missing deadline, 422) answers at once. */
const retry = retryUnlessRefused([404, 422])

/** A short, stable key for a document (FNV-1a over its JSON, with its length): equal documents key alike. */
export function documentKey(document: unknown): string {
  const text = (JSON.stringify(document) as string | undefined) ?? ''
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(36)}:${String(text.length)}`
}

/**
 * A document priced on the held applications (§S5 E: the strip's draft figures and its starting point's), on the
 * Price ▾ request set. Evaluate writes nothing, so it is a cached read: its answer is fixed by its key (the document,
 * the snapshot and the request set) except for what the rules and money writers move (an approval, a posted round,
 * the budget), so `invalidateAidRulesQueries` and `invalidateAidMoneyQueries` refresh it. A scenario write
 * (`invalidateAidScenarioQueries`) leaves it alone: a release, a load or Update Applications changes the key itself
 * (#3047 scan DECIDE 2). App cache defaults; the previous answer stays on screen while the next is asked
 * (`isPlaceholderData`: the strip's 60% dimming).
 */
export function useAidScenarioPricing(
  document: ApiAidRulesDocumentIn | null | undefined,
  requestSet: AidRequestSet,
  snapshotId: string | null
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const key = document === null || document === undefined ? '' : documentKey(document)
  return useQuery({
    queryKey: queryKeys.aidScenarioEvaluate(year, snapshotId ?? '', setKey(requestSet), key),
    queryFn: ({ signal }) => {
      if (document === null || document === undefined) throw new Error('Nothing to price')
      return evaluateAidScenario(
        fetchWithAuth,
        year,
        { document, ...requestSetBody(requestSet) },
        signal
      )
    },
    enabled:
      year > 0 &&
      !authLoading &&
      hasPermission(Permission.FINANCIAL_AID_RULES) &&
      document !== null &&
      document !== undefined &&
      snapshotId !== null,
    retry,
    placeholderData: keepPreviousData,
  })
}
