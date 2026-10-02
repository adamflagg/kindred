import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  decideAidRound3,
  keyAidAsk,
  keyAidRound3Amount,
  setAidCancellation,
  setAidHoldRelease,
  setAidManualHold,
  tickAidAccepted,
  tickAidPosted,
  undoAidPosted,
} from '../../services/camperships/aidApi'
import type { FetchWithAuth } from '../../services/lodgingApi'
import type {
  ApiAidAcceptedIn,
  ApiAidAskIn,
  ApiAidCancellationIn,
  ApiAidHoldReleaseIn,
  ApiAidManualHoldIn,
  ApiAidPostedIn,
  ApiAidRound3AmountIn,
  ApiAidRound3ApprovalIn,
  ApiAidUnpostIn,
} from '../../types/api-types'
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

/** A write on one request. */
export interface RequestVars<B> {
  readonly requestId: string
  readonly body: B
}

export interface UndoPostedVars {
  readonly year: number
  readonly body: ApiAidUnpostIn
}

/** Undo a mistaken Posted tick, with its reason (§5.1). */
export function useAidUndoPosted() {
  return useAidWrite((fetchWithAuth, vars: UndoPostedVars) =>
    undoAidPosted(fetchWithAuth, vars.year, vars.body)
  )
}

/** A Round 3 amount (§4.6; D22, D79). */
export function useAidRound3Amount() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidRound3AmountIn>) =>
    keyAidRound3Amount(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Finance's decision on a Round 3 waiting on it (D79). */
export function useAidRound3Decision() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidRound3ApprovalIn>) =>
    decideAidRound3(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Release a check's hold, or put it back (main spec §10.5). */
export function useAidHoldRelease() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidHoldReleaseIn>) =>
    setAidHoldRelease(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Place or lift the manual hold (§6.3). */
export function useAidManualHold() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidManualHoldIn>) =>
    setAidManualHold(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Cancel, give a reason, or reopen (D101, D141). */
export function useAidCancellation() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidCancellationIn>) =>
    setAidCancellation(fetchWithAuth, vars.requestId, vars.body)
  )
}
