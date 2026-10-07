import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidPromotionPreview,
  fitAidScenario,
  makeAidRulesDraft,
  retryUnlessRefused,
} from '../../services/camperships/aidApi'
import type { ApiAidMakeRulesDraftIn, ApiAidRulesDocumentIn } from '../../types/api-types'
import { invalidateAidRulesQueries, queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A refusal in the server's words (no such option, 404; nothing to change, 422) answers at once. */
const retry = retryUnlessRefused([404, 422])

/**
 * Fit to budget (§7.4; D119): a read that records nothing, so it refreshes nothing. Its answer is
 * shown beside the draft until "Use it" records the document (useAidScenarioDraft's `adopt`).
 */
export function useAidScenarioFit() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (document: ApiAidRulesDocumentIn) =>
      fitAidScenario(fetchWithAuth, year, { document }),
  })
}

/**
 * What "Make <code> the rules draft" would change (D39). It reads the rules draft as it is now, so a
 * rules write refreshes it (`invalidateAidRulesQueries` takes the scenarios prefix too). `rules` only,
 * like every scenario route.
 */
export function useAidPromotionPreview(code: string | null) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidPromotionPreview(year, code ?? ''),
    queryFn: () => fetchAidPromotionPreview(fetchWithAuth, year, code ?? ''),
    enabled:
      year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_RULES) && code !== null,
    retry,
  })
}

export interface PromoteVars {
  readonly code: string
  readonly body: ApiAidMakeRulesDraftIn
}

/**
 * Copy a kept option's changed sections into the rules draft (D39). It writes the rules draft, never
 * the approved rules, so it refreshes the rules, Today's Finance line, History and the scenarios, and
 * no money read: nothing is priced until the sections are approved. On settle, a 409 included.
 */
export function useAidMakeRulesDraft() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: PromoteVars) => makeAidRulesDraft(fetchWithAuth, year, vars.code, vars.body),
    onSettled: () => invalidateAidRulesQueries(queryClient),
  })
}
