import {
  addAidCorrection,
  decideAidRound3,
  keyAidAsk,
  keyAidRound3Amount,
  markAidDuplicate,
  resolveAidSession,
  setAidCancellation,
  setAidCostOverride,
  setAidHeadcount,
  setAidHoldRelease,
  setAidHouseholdShare,
  setAidManualHold,
  tickAidAccepted,
  tickAidPosted,
  undoAidPosted,
  applyAidForm,
} from '../../services/camperships/aidApi'
import type {
  ApiAidAcceptedIn,
  ApiAidAskIn,
  ApiAidCancellationIn,
  ApiAidCorrectionIn,
  ApiAidDuplicateIn,
  ApiAidCostOverrideIn,
  ApiAidHeadcountIn,
  ApiAidHoldReleaseIn,
  ApiAidHouseholdShareIn,
  ApiAidManualHoldIn,
  ApiAidPostedIn,
  ApiAidRound3AmountIn,
  ApiAidRound3ApprovalIn,
  ApiAidSessionIn,
  ApiAidUnpostIn,
  ApiAidUseFormIn,
} from '../../types/api-types'
import { useAidWrite } from './useAidWrite'

// The shared write hook lives in its own module, so a test that stubs these writes still gets the real one.
export { useAidWrite } from './useAidWrite'

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

/** Set the cost a request is priced at, or clear it (D22). */
export function useAidCostOverride() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidCostOverrideIn>) =>
    setAidCostOverride(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Cancel, give a reason, or reopen (D101, D141). */
export function useAidCancellation() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidCancellationIn>) =>
    setAidCancellation(fetchWithAuth, vars.requestId, vars.body)
  )
}

export interface CorrectionVars {
  readonly year: number
  readonly householdCmId: number
  readonly body: ApiAidCorrectionIn
}

/** Correct an answer on the application (main spec §9.3). */
export function useAidCorrection() {
  return useAidWrite((fetchWithAuth, vars: CorrectionVars) =>
    addAidCorrection(fetchWithAuth, vars.year, vars.householdCmId, vars.body)
  )
}

export interface UseFormVars {
  readonly year: number
  readonly householdCmId: number
  readonly body: ApiAidUseFormIn
}

/** Use X's Form (#3021): one camper's form for every answer the household's forms disagree on. */
export function useAidUseForm() {
  return useAidWrite((fetchWithAuth, vars: UseFormVars) =>
    applyAidForm(fetchWithAuth, vars.year, vars.householdCmId, vars.body)
  )
}

export interface HouseholdShareVars {
  readonly requestId: string
  readonly householdCmId: number
  readonly body: ApiAidHouseholdShareIn
}

/** One household's payer share. A household joining or leaving changes who has aid activity: the jump index too (#2924). */
export function useAidHouseholdShare() {
  return useAidWrite(
    (fetchWithAuth, vars: HouseholdShareVars) =>
      setAidHouseholdShare(fetchWithAuth, vars.requestId, vars.householdCmId, vars.body),
    { jumpIndex: true }
  )
}

/** Settle a request's session (main spec §9.1). */
export function useAidSessionResolve() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidSessionIn>) =>
    resolveAidSession(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** Mark a request the duplicate of the one kept (main spec §9.2). */
export function useAidDuplicate() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidDuplicateIn>) =>
    markAidDuplicate(fetchWithAuth, vars.requestId, vars.body)
  )
}

/** A Family Camp headcount (main spec §8). */
export function useAidHeadcount() {
  return useAidWrite((fetchWithAuth, vars: RequestVars<ApiAidHeadcountIn>) =>
    setAidHeadcount(fetchWithAuth, vars.requestId, vars.body)
  )
}
