import { useMutation, useQueryClient } from '@tanstack/react-query'

import { keyAidAsk, tickAidAccepted, tickAidPosted } from '../../services/camperships/aidApi'
import type { FetchWithAuth } from '../../services/lodgingApi'
import type { ApiAidAcceptedIn, ApiAidAskIn, ApiAidPostedIn } from '../../types/api-types'
import { invalidateAidMoneyQueries } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'

/**
 * One Camperships write (spec §10; #2924's invalidation table). It refreshes on settle, not only
 * on success: a refusal can mean the data moved under the person (a 409), and they should see it.
 */
function useAidWrite<Vars, Out>(
  write: (fetchWithAuth: FetchWithAuth, vars: Vars) => Promise<Out>,
  options: { readonly jumpIndex?: boolean } = {}
) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const jumpIndex = options.jumpIndex === true
  return useMutation({
    mutationFn: (vars: Vars) => write(fetchWithAuth, vars),
    // Returned: mutateAsync resolves after the reads refresh, so a reopened editor (M8's remount)
    // starts from the saved figure, never the old one (build ruling 1).
    onSettled: () => invalidateAidMoneyQueries(queryClient, { jumpIndex }),
  })
}

export interface AskVars {
  readonly requestId: string
  readonly body: ApiAidAskIn
}

/** A family's Round 2 or Round 3 ask (§4.6; D22, D91). */
export function useAidKeyAsk() {
  return useAidWrite((fetchWithAuth, vars: AskVars) =>
    keyAidAsk(fetchWithAuth, vars.requestId, vars.body)
  )
}

export interface PostedVars {
  readonly year: number
  readonly body: ApiAidPostedIn
}

/** The Posted tick, one row or many (§4.10; D51, D52). */
export function useAidTickPosted() {
  return useAidWrite((fetchWithAuth, vars: PostedVars) =>
    tickAidPosted(fetchWithAuth, vars.year, vars.body)
  )
}

export interface AcceptedVars {
  readonly year: number
  readonly body: ApiAidAcceptedIn
}

/** The Accepted tick, one row or many (§5.2; D47). */
export function useAidTickAccepted() {
  return useAidWrite((fetchWithAuth, vars: AcceptedVars) =>
    tickAidAccepted(fetchWithAuth, vars.year, vars.body)
  )
}
