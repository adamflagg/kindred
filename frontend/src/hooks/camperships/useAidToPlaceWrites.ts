import {
  leaveAidLine,
  placeAidLine,
  placeAidLines,
  reclassifyAidLine,
  reopenAidLine,
} from '../../services/camperships/aidApi'
import type {
  ApiAidPlaceLineIn,
  ApiAidPlaceLinesIn,
  ApiAidReclassifyLineIn,
} from '../../types/api-types'
import { useAidWrite } from './useAidWrites'

/**
 * Money › To place's writes (spec §8.1; SP11). Each refreshes on settle through
 * `invalidateAidMoneyQueries` (a placement ticks Posted, moving Remaining, Rounds & budget, the grid,
 * Today, the household pages, To place itself, and the Ledger, which reads the dashboard's placements for
 * its level, D151). The base refresh carries all of it.
 */

export interface PlaceLineVars {
  readonly year: number
  readonly transactionCmId: number
  readonly body: ApiAidPlaceLineIn
}

/** Confirm, Split, or place on another request: one line (D12). */
export function useAidPlaceLine() {
  return useAidWrite((fetchWithAuth, vars: PlaceLineVars) =>
    placeAidLine(fetchWithAuth, vars.year, vars.transactionCmId, vars.body)
  )
}

export interface PlaceLinesVars {
  readonly year: number
  readonly body: ApiAidPlaceLinesIn
}

/** A bulk confirm (D16; §4.10's one exception: its total is an estimate). */
export function useAidPlaceLines() {
  return useAidWrite((fetchWithAuth, vars: PlaceLinesVars) =>
    placeAidLines(fetchWithAuth, vars.year, vars.body)
  )
}

export interface LeaveLineVars {
  readonly year: number
  readonly transactionCmId: number
  readonly note: string
}

/** Leave at family level, with a note (D58). */
export function useAidLeaveLine() {
  return useAidWrite((fetchWithAuth, vars: LeaveLineVars) =>
    leaveAidLine(fetchWithAuth, vars.year, vars.transactionCmId, { note: vars.note })
  )
}

export interface ReopenLineVars {
  readonly year: number
  readonly transactionCmId: number
  readonly reason: string
}

/** Reopen a line left at family level, with a reason. */
export function useAidReopenLine() {
  return useAidWrite((fetchWithAuth, vars: ReopenLineVars) =>
    reopenAidLine(fetchWithAuth, vars.year, vars.transactionCmId, vars.reason)
  )
}

export interface ReclassifyLineVars {
  readonly year: number
  readonly transactionCmId: number
  readonly body: ApiAidReclassifyLineIn
}

/** Reclassify a line as another aid source (D104; `rules`). */
export function useAidReclassifyLine() {
  return useAidWrite((fetchWithAuth, vars: ReclassifyLineVars) =>
    reclassifyAidLine(fetchWithAuth, vars.year, vars.transactionCmId, vars.body)
  )
}
