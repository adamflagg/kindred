/**
 * Resolve the AG session linked to a main session.
 *
 * AG bunks live in their own session whose `parent_id` points at the main
 * session's `cm_id` (see docs/architecture/session-types.md). This mirrors the
 * bunk board's `getAgSessions` / `shouldShowAgArea` gate: an AG tab/area is
 * offered only when a linked AG session exists AND has bunk_plans.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { useYear } from './useCurrentYear'
import type { Session } from '../types/app-types'
import type { BunkPlansResponse } from '../types/pocketbase-types'

export interface LinkedAgSessionResult {
  /** CampMinder ID of the linked AG session, or null if none/empty. */
  agSessionCmId: number | null
  isLoading: boolean
}

export function useLinkedAgSession(mainSessionCmId: number): LinkedAgSessionResult {
  const year = useYear()

  const { data, isLoading } = useQuery({
    queryKey: ['linked-ag-session', mainSessionCmId, year],
    queryFn: async (): Promise<number | null> => {
      const sessions = await pb
        .collection<Session>('camp_sessions')
        .getFullList({ filter: `year = ${year}` })
      const ag = sessions.find((s) => s.session_type === 'ag' && s.parent_id === mainSessionCmId)
      if (!ag) return null
      const plans = await pb
        .collection<BunkPlansResponse>('bunk_plans')
        .getFullList({ filter: `session = "${ag.id}" && year = ${year}` })
      return plans.length > 0 ? ag.cm_id : null
    },
  })

  return { agSessionCmId: data ?? null, isLoading }
}
