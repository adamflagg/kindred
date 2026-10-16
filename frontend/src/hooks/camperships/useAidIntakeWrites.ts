import type { AdditionCreateIn } from '../../components/camperships/intake/intakeTypes'
import {
  addAidRequest,
  retireAidAddition,
  reviewAidAddition,
} from '../../services/camperships/aidApi'
import { useAidWrite } from './useAidWrite'

/**
 * Form intake's writes (PR 3), casework. Each refreshes every aid read on settle (`useAidWrite`), the intake prefix
 * among them: Form intake, the Requests band's count, Season's line, Requests, the household page and Today.
 */
export interface AddRequestVars {
  readonly year: number
  readonly body: AdditionCreateIn
}

/** Add a Request…: a household gains aid activity, so the jump box's index too. */
export function useAidAddRequest() {
  return useAidWrite(
    (fetchWithAuth, vars: AddRequestVars) => addAidRequest(fetchWithAuth, vars.year, vars.body),
    { jumpIndex: true }
  )
}

export interface AdditionVars {
  readonly year: number
  readonly additionId: string
}

/** Mark Reviewed (owner Q2-A). */
export function useAidReviewAddition() {
  return useAidWrite((fetchWithAuth, vars: AdditionVars) =>
    reviewAidAddition(fetchWithAuth, vars.year, vars.additionId)
  )
}

/** Remove… on an added request's household card. */
export function useAidRetireAddition() {
  return useAidWrite((fetchWithAuth, vars: AdditionVars & { readonly reason: string }) =>
    retireAidAddition(fetchWithAuth, vars.year, vars.additionId, vars.reason)
  )
}
