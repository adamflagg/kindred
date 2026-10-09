import {
  createAidGrantor,
  retireAidGrantor,
  saveAidGrantor,
  unretireAidGrantor,
} from '../../services/camperships/aidApi'
import type { ApiAidGrantorCreate, ApiAidGrantorSave } from '../../types/api-types'
import { useAidWrite } from './useAidWrites'

/**
 * Money › Funders' writes (spec §8.2; D86, D143, D160; `grantors`, held by finance and development:
 * owner 10-06, rulings:676). Each refreshes on settle through `invalidateAidMoneyQueries` with
 * `registry`: the directory, the sources registry (a description's grantor name), Grants (names on the
 * Register) and every money read, because a grantor's full coverage and "pays the rest after camp aid"
 * decide whether its grants lower an award (D143).
 */

/** Create a grantor. */
export function useAidCreateGrantor() {
  return useAidWrite(
    (fetchWithAuth, body: ApiAidGrantorCreate) => createAidGrantor(fetchWithAuth, body),
    { registry: true }
  )
}

export interface SaveGrantorVars {
  readonly key: string
  readonly body: ApiAidGrantorSave
}

/** Save a grantor whole (a rename and its award terms included). */
export function useAidSaveGrantor() {
  return useAidWrite(
    (fetchWithAuth, vars: SaveGrantorVars) => saveAidGrantor(fetchWithAuth, vars.key, vars.body),
    { registry: true }
  )
}

export interface RetireGrantorVars {
  readonly key: string
  readonly reason: string
}

/** Retire a grantor, with a reason (D160). */
export function useAidRetireGrantor() {
  return useAidWrite(
    (fetchWithAuth, vars: RetireGrantorVars) =>
      retireAidGrantor(fetchWithAuth, vars.key, { reason: vars.reason }),
    { registry: true }
  )
}

/** Unretire a grantor, with a reason. */
export function useAidUnretireGrantor() {
  return useAidWrite(
    (fetchWithAuth, vars: RetireGrantorVars) =>
      unretireAidGrantor(fetchWithAuth, vars.key, { reason: vars.reason }),
    { registry: true }
  )
}
