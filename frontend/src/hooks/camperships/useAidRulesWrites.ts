import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useSeasonChrome } from '../../components/camperships/season/seasonChrome'

import {
  approveAidRules,
  discardAidRulesDraft,
  fetchAidRulesDraft,
  saveAidRulesSection,
  saveAidRulesSections,
  startAidRulesFromLastYear,
} from '../../services/camperships/aidApi'
import type { FetchWithAuth } from '../../services/lodgingApi'
import type {
  ApiAidDiscardDraftIn,
  ApiAidRulesApproveIn,
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidSectionSaveIn,
  ApiAidSectionsSaveIn,
} from '../../types/api-types'
import { invalidateAidRulesQueries, queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

export interface SectionSaveVars {
  readonly section: ApiAidRulesSection
  readonly body: ApiAidSectionSaveIn
}

export interface ApproveVars {
  readonly version: number
  readonly body: ApiAidRulesApproveIn
}

/**
 * A rules write (spec §7.5, §10). It refreshes on settle, not only on success: a 409 (G6) means the
 * rules moved under the person, and the screen has to show them what moved. The refresh's promise is
 * returned so the mutation waits for the refetch. `priced`: the write re-prices the season (an
 * approval), so every money read refreshes too. A save never edits the pricing version in place and
 * a start creates every section as a draft, so both are unpriced.
 */
function useRulesWrite<Vars, Out>(
  write: (
    fetchWithAuth: FetchWithAuth,
    year: number,
    vars: Vars,
    pastSeasonReason: string | null
  ) => Promise<Out>,
  priced: boolean
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  // A done season's unlock reason (spec §11.3); null outside a Season page and while locked.
  const { pastSeasonReason } = useSeasonChrome()
  return useMutation({
    mutationFn: (vars: Vars) => write(fetchWithAuth, year, vars, pastSeasonReason),
    onSettled: () => invalidateAidRulesQueries(queryClient, { priced }),
  })
}

/** One section editor's save into the rules draft (D39): prices nothing until approved. */
export function useAidSaveRulesSection() {
  return useRulesWrite(
    (fetchWithAuth, year, vars: SectionSaveVars, reason) =>
      saveAidRulesSection(fetchWithAuth, year, vars.section, vars.body, reason),
    false
  )
}

/** The Programs and costs card's save: programs and cost in one operation (D39): prices nothing until approved. */
export function useAidSaveRulesSections() {
  return useRulesWrite(
    (fetchWithAuth, year, body: ApiAidSectionsSaveIn, reason) =>
      saveAidRulesSections(fetchWithAuth, year, body, reason),
    false
  )
}

/** Approve sections with a note naming the approving body (D39): may re-price the season. */
export function useAidApproveRules() {
  return useRulesWrite(
    (fetchWithAuth, year, vars: ApproveVars, reason) =>
      approveAidRules(fetchWithAuth, year, vars.version, vars.body, reason),
    true
  )
}

/** Start an empty season from last season's rules, every section a draft (§7.5). */
export function useAidStartRulesFromLastYear() {
  return useRulesWrite(
    (fetchWithAuth, year, _vars: undefined, reason) =>
      startAidRulesFromLastYear(fetchWithAuth, year, reason),
    false
  )
}

/** Throw the rules draft away (owner 2026-10-08): back to the version in effect, which prices as before. */
export function useAidDiscardRulesDraft() {
  return useRulesWrite(
    (fetchWithAuth, year, body: ApiAidDiscardDraftIn, reason) =>
      discardAidRulesDraft(fetchWithAuth, year, body, reason),
    false
  )
}

/**
 * The rules draft as the server holds it now, never the cache (Decisions 16-17; plan review C1, C2).
 * The editor and the approval form read it when they open and again just before they send, so a
 * write is never made against a section someone else has since changed. It lands in the Rules tab's
 * own key, so the tab shows what was read. A failed read rejects: the caller keeps the typing.
 */
export function useFreshAidRulesDraft(): () => Promise<ApiAidRulesDraft> {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.aidRulesDraft(year),
        queryFn: () => fetchAidRulesDraft(fetchWithAuth, year),
        staleTime: 0,
      }),
    [queryClient, year, fetchWithAuth]
  )
}
