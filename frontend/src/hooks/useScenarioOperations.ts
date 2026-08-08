import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import type { SavedScenario } from '../types/app-types'
import { clearScenario as clearScenarioRequest } from '../services/scenariosApi'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

interface UpdateScenarioParams {
  scenarioId: string
  updates: {
    name?: string
    description?: string
    is_active?: boolean
  }
}

interface ClearScenarioParams {
  scenarioId: string
  year: number
  /**
   * The scenario's own session, for cache invalidation only — the server
   * resolves the program (and so which draft table to clear) from the
   * scenario's own `session` relation, not from this.
   */
  sessionCmId: number
}

export function useUpdateScenario() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ scenarioId, updates }: UpdateScenarioParams) => {
      const updateData: Record<string, unknown> = {}

      if (updates.name !== undefined) updateData['name'] = updates.name
      if (updates.description !== undefined) updateData['description'] = updates.description
      if (updates.is_active !== undefined) updateData['is_active'] = updates.is_active

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update')
      }

      return await pb
        .collection<SavedScenario>('saved_scenarios')
        .update(scenarioId, updateData, { expand: 'session' })
    },
    onSuccess: () => {
      // Invalidate scenarios query to refetch
      void queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] })
      // Note: We can't easily get the session CM ID from the update response
      // So we invalidate all scenario queries to be safe
    },
  })
}

/**
 * Clear every assignment in a scenario.
 *
 * Routed through `POST /api/scenarios/{id}/clear` (kindred#2021),
 * program-aware server-side, rather than a client-side delete loop over
 * `bunk_assignments_draft`. That table is empty for a weekend session by
 * construction (weekend drafts live in `lodging_assignments_draft`), so the
 * old client-side version reported "cleared" while deleting nothing — the
 * bug this issue is titled after.
 */
export function useClearScenario() {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()

  return useMutation({
    mutationFn: async ({ scenarioId, year }: ClearScenarioParams) => {
      return await clearScenarioRequest(fetchWithAuth, scenarioId, year)
    },
    onSuccess: (_result, { scenarioId, year, sessionCmId }) => {
      // Summer: unchanged from before this hook moved server-side.
      void queryClient.invalidateQueries({ queryKey: ['bunk-assignments'] })
      // Weekend: a no-op for a summer sessionCmId, since nothing is cached
      // under these keys for one. Required for the same reason
      // useCreateScenario invalidates them (CLAUDE.md §4: a 30-minute
      // staleTime needs every writer to invalidate explicitly).
      void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummary(year) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.weekendRoster(year, sessionCmId, scenarioId),
      })
    },
  })
}
