/**
 * Hook returning the current bunk for each cohort camper.
 *
 * The cohort drill-down modal shows "5th grade · Bunk 4" inline next to
 * each camper. The source of truth follows the active scenario:
 *  - currentScenario === null → bunk_assignments  (production)
 *  - currentScenario set       → bunk_assignments_draft scoped by scenario
 *
 * The returned Map always contains an entry for every requested personCmId
 * (null when no assignment exists), so render-time logic can branch on the
 * value rather than juggling has() vs get().
 */
import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { ScenarioContext } from './useScenario'
import { queryKeys, userDataOptions } from '../utils/queryKeys'

interface AssignmentExpand {
  expand?: {
    person?: { cm_id?: number }
    bunk?: { name?: string } | null
  }
}

export interface UseCohortBunkAssignmentsResult {
  bunkByPerson: Map<number, string | null>
  isLoading: boolean
}

export function useCohortBunkAssignments(
  personCmIds: number[],
  sessionCmId: number,
  year: number
): UseCohortBunkAssignmentsResult {
  // Consume ScenarioContext directly (rather than the throwing useScenario
  // helper) so this hook degrades to production mode when rendered outside a
  // provider — matters for tests of the parent section, and for any future
  // consumer that lives outside the bunking-board tree.
  const scenarioCtx = useContext(ScenarioContext)
  const scenarioId = scenarioCtx?.currentScenario?.id ?? null
  const enabled = personCmIds.length > 0 && sessionCmId > 0

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.cohortBunkAssignments(scenarioId, sessionCmId, year, personCmIds),
    queryFn: async (): Promise<Map<number, string | null>> => {
      const collection = scenarioId ? 'bunk_assignments_draft' : 'bunk_assignments'
      const baseFilter = scenarioId
        ? `scenario = "${scenarioId}" && year = ${year}`
        : `session.cm_id = ${sessionCmId} && year = ${year}`
      const rows = await pb.collection(collection).getFullList<AssignmentExpand>({
        filter: baseFilter,
        expand: 'person,bunk',
      })

      // Pre-seed every requested camper to null so consumers can render
      // "Unassigned" off a single map lookup. Then overwrite where we
      // actually have data.
      const map = new Map<number, string | null>()
      for (const cmId of personCmIds) map.set(cmId, null)

      const wanted = new Set(personCmIds)
      for (const row of rows) {
        const cmId = row.expand?.person?.cm_id
        if (cmId == null || !wanted.has(cmId)) continue
        const name = row.expand?.bunk?.name ?? null
        map.set(cmId, name)
      }
      return map
    },
    enabled,
    ...userDataOptions,
  })

  return {
    bunkByPerson: data ?? new Map<number, string | null>(),
    isLoading: enabled ? isLoading : false,
  }
}
