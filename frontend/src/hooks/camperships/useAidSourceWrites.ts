import {
  classifyAidSource,
  mapAidSourceGrantor,
  saveAidFundingSource,
} from '../../services/camperships/aidApi'
import type {
  ApiAidFundingSourceIn,
  ApiAidSourceGrantorIn,
  ApiAidSourceUpdate,
} from '../../types/api-types'
import { useAidWrite } from './useAidWrites'

/**
 * Money › Funders' writes (spec §8.1; D58, D100, D159, D160). Each refreshes on settle through
 * `invalidateAidMoneyQueries` with `registry`: a classification moves what counts as aid and toward
 * the budget (Rounds & budget, Remaining, the grid, every award), the Ledger and To place; a grantor
 * mapping moves the directory's descriptions, the Register's grantor names and a full-coverage
 * grantor's effect on awards (D143); a group re-places household-level lines at the next sync (D159).
 * `registry` reaches the sources prefix, so the registry and Funding sources both refresh.
 */

export interface ClassifyVars {
  readonly sourceId: string
  readonly body: ApiAidSourceUpdate
}

/** Classify a description (`rules`). */
export function useAidClassifySource() {
  return useAidWrite(
    (fetchWithAuth, vars: ClassifyVars) =>
      classifyAidSource(fetchWithAuth, vars.sourceId, vars.body),
    { registry: true }
  )
}

export interface MapGrantorVars {
  readonly sourceId: string
  readonly body: ApiAidSourceGrantorIn
}

/** Map a description to its grantor, or unmap it (`grantors`). */
export function useAidMapSourceGrantor() {
  return useAidWrite(
    (fetchWithAuth, vars: MapGrantorVars) =>
      mapAidSourceGrantor(fetchWithAuth, vars.sourceId, vars.body),
    { registry: true }
  )
}

export interface SetGroupVars {
  readonly year: number
  readonly sourceId: string
  readonly body: ApiAidFundingSourceIn
}

/** "Set a Group…": a source's reporting group and incentive flag (`rules` here; the route also takes `funding_sources`). */
export function useAidSetSourceGroup() {
  return useAidWrite(
    (fetchWithAuth, vars: SetGroupVars) =>
      saveAidFundingSource(fetchWithAuth, vars.year, vars.sourceId, vars.body),
    { registry: true }
  )
}
