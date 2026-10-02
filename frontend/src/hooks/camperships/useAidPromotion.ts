import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchAidPromotionPreview,
  fitAidScenario,
  makeAidRulesDraft,
} from '../../services/camperships/aidApi'
import type { ApiAidMakeRulesDraftIn, ApiAidRulesDocumentIn } from '../../types/api-types'
import { invalidateAidRulesQueries, queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

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
 * rules write refreshes it (`invalidateAidRulesQueries` takes the scenarios prefix too).
 */
export function useAidPromotionPreview(code: string | null) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.aidPromotionPreview(year, code ?? ''),
    queryFn: () => fetchAidPromotionPreview(fetchWithAuth, year, code ?? ''),
    enabled: year > 0 && code !== null,
    retry: false,
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
