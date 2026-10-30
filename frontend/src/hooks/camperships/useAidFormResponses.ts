import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { FormResponseIgnore } from '../../components/camperships/intake/intakeTypes'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidLinkCandidates,
  ignoreAidFormResponse,
  linkAidFormResponse,
  pullAidGoogleForm,
  reviewAidFormChange,
} from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidWrite } from './useAidWrite'

/**
 * Form intake's adult aid form reads and writes (adult aid form design §5, §10; PR 3), casework. The read inherits the
 * app's cache defaults: it sits under the intake prefix, so every aid write (these included) clears it. Each write
 * refreshes every aid read on settle (`useAidWrite`): Form intake, Today, the household page and Requests among them.
 */

/** Link…'s own read for the opened response (`recordId`), or with `q` a search of the season's registrations. */
export function useAidLinkCandidates(recordId: string | null, q = '') {
  const year = useYear()
  const { isLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const { fetchWithAuth } = useApiWithAuth()
  const query = q.trim()
  return useQuery({
    queryKey: queryKeys.aidIntakeLinkCandidates(year, recordId ?? '', query),
    queryFn: () => fetchAidLinkCandidates(fetchWithAuth, year, recordId ?? '', query),
    enabled:
      recordId !== null &&
      year > 0 &&
      !isLoading &&
      hasPermission(Permission.FINANCIAL_AID_CASEWORK),
  })
}

export interface LinkVars {
  readonly year: number
  readonly id: string
  readonly personCmId: number
}

/** Link…: a request is made for the person, so a household may gain aid activity (the jump box's index too). */
export function useAidLinkResponse() {
  return useAidWrite(
    (fetchWithAuth, vars: LinkVars) =>
      linkAidFormResponse(fetchWithAuth, vars.year, vars.id, { person_cm_id: vars.personCmId }),
    { jumpIndex: true }
  )
}

export interface IgnoreVars {
  readonly year: number
  readonly id: string
  readonly body: FormResponseIgnore
}

/** Ignore…. */
export function useAidIgnoreResponse() {
  return useAidWrite((fetchWithAuth, vars: IgnoreVars) =>
    ignoreAidFormResponse(fetchWithAuth, vars.year, vars.id, vars.body)
  )
}

/** Mark Reviewed on a request whose adult aid form was deleted in Google or changed after a decision (owner Q2). */
export function useAidReviewFormChange() {
  return useAidWrite((fetchWithAuth, vars: { readonly year: number; readonly requestId: string }) =>
    reviewAidFormChange(fetchWithAuth, vars.year, vars.requestId)
  )
}

/**
 * When Form intake and Today read again after Pull Now, in ms from the pull. The pull only starts the read (202): it
 * reads Google and rebuilds the season's requests in the background, which takes seconds to a minute, so the list
 * refreshes a few times rather than once too early. Not a standing poll: it stops after the last, and on leaving.
 */
export const PULL_REFRESH_MS: readonly number[] = [8_000, 20_000, 45_000]

/** Pull Now: starts the read, then refreshes Form intake and Today as it can land. */
export function useAidPullForm() {
  const queryClient = useQueryClient()
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
    },
    []
  )
  const write = useAidWrite((fetchWithAuth, vars: { readonly year: number }) =>
    pullAidGoogleForm(fetchWithAuth, vars.year)
  )
  return {
    ...write,
    mutateAsync: async (vars: { readonly year: number }) => {
      const out = await write.mutateAsync(vars)
      for (const t of timers.current) clearTimeout(t)
      timers.current = PULL_REFRESH_MS.map((ms) =>
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.aidIntakePrefix() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.aidTodayPrefix() })
        }, ms)
      )
      return out
    },
  }
}
