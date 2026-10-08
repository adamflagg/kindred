import {
  createAidCommitment,
  placeAidGrants,
  saveAidCommitment,
  withdrawAidCommitment,
} from '../../services/camperships/aidApi'
import type { ApiAidCommitmentIn, ApiAidPlaceGrantsIn } from '../../types/api-types'
import { useAidWrite } from './useAidWrites'

/**
 * Grants' writes (spec §8.2; casework). Each refreshes on settle through `invalidateAidMoneyQueries`'s
 * base set: a grant placed on a camper, or a commitment, prices that camper's unposted rounds (D116;
 * a posted round stands), so Remaining, Rounds & budget, the grid, the household pages, Grants and the
 * Ledger (which reads the placements, D151) all move. None touches the sources or the grantors.
 */

export interface PlaceGrantsVars {
  readonly year: number
  readonly body: ApiAidPlaceGrantsIn
}

/** Confirm grant lines' campers: one, or a bulk of single suggestions (S3-6). */
export function useAidPlaceGrants() {
  return useAidWrite((fetchWithAuth, vars: PlaceGrantsVars) =>
    placeAidGrants(fetchWithAuth, vars.year, vars.body)
  )
}

export interface CommitmentVars {
  readonly year: number
  readonly body: ApiAidCommitmentIn
}

/** Record a commitment (D55). */
export function useAidCreateCommitment() {
  return useAidWrite((fetchWithAuth, vars: CommitmentVars) =>
    createAidCommitment(fetchWithAuth, vars.year, vars.body)
  )
}

export interface SaveCommitmentVars extends CommitmentVars {
  readonly commitmentId: string
}

/** Save a commitment whole. */
export function useAidSaveCommitment() {
  return useAidWrite((fetchWithAuth, vars: SaveCommitmentVars) =>
    saveAidCommitment(fetchWithAuth, vars.year, vars.commitmentId, vars.body)
  )
}

export interface WithdrawCommitmentVars {
  readonly year: number
  readonly commitmentId: string
  readonly reason: string
}

/** Withdraw a commitment, with a reason. */
export function useAidWithdrawCommitment() {
  return useAidWrite((fetchWithAuth, vars: WithdrawCommitmentVars) =>
    withdrawAidCommitment(fetchWithAuth, vars.year, vars.commitmentId, { reason: vars.reason })
  )
}
