import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb, getCurrentUser } from '../lib/pocketbase'
import type { SavedScenario } from '../types/app-types'
import type { Scenario } from './useScenario'
import { createScenario as createScenarioRequest } from '../services/scenariosApi'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

interface CreateScenarioParams {
  name: string
  session_cm_id: number
  year: number
  description?: string
  copyOptions?: { fromProduction: boolean } | { fromScenario: string }
}

/**
 * Create a scenario: blank, copied from production, or copied from another
 * scenario.
 *
 * Routed through `POST /api/scenarios` (kindred#2021), program-aware
 * server-side, rather than the raw PocketBase SDK plus a client-side copy
 * loop. The old client-side path (`copyProductionToScenario` /
 * `copyScenarioToScenario`, retired with this change) only ever read
 * `bunk_assignments` / `bunk_assignments_draft` — summer-only in substance,
 * so "copy from CampMinder" silently copied zero rows for a weekend
 * session. One backend call now does the right copy for either program,
 * which is what lets the create modal offer the same three choices for
 * both (`ScenarioManagementModal`, `WeekendScenarioPicker`).
 */
export function useCreateScenario() {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()

  return useMutation({
    mutationFn: async (params: CreateScenarioParams): Promise<Scenario> => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('User must be authenticated to create scenarios')
      }

      return await createScenarioRequest(fetchWithAuth, {
        name: params.name,
        sessionCmId: params.session_cm_id,
        year: params.year,
        ...(params.description !== undefined && { description: params.description }),
        // Omitted copyOptions means BLANK, not "let the backend decide" —
        // CreateScenarioRequest.should_copy_from_production defaults an
        // absent copy_from_production/copy_from_scenario pair to copying
        // from production (kept for callers that predate copyOptions
        // existing at all). The retired client-side path's own contract was
        // the opposite: `if (params.copyOptions) { ...copy... }` did nothing
        // at all when the param was omitted. Explicit here so this hook
        // keeps that contract rather than silently inheriting the
        // backend's different default.
        copyFrom: params.copyOptions ?? { fromProduction: false },
      })
    },
    onSuccess: (scenario, params) => {
      // Broad first: TanStack Query's default partial matching means this
      // alone invalidates every savedScenarios(...) variant, but the
      // specific key is kept too, matching what this hook has always done.
      void queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.savedScenarios(params.session_cm_id, params.year),
      })
      // The backend may have seeded lodging_assignments_draft for a weekend
      // scenario (LodgingWriteService, inside POST /api/scenarios). Those
      // queries default to a 30-minute staleTime (userDataOptions), so
      // without this a weekend board that already fetched the mirror or an
      // older scenario would show the pre-seed state for up to half an hour
      // (CLAUDE.md §4: "if you lengthen a staleTime, find every writer
      // first"). A no-op for a summer session — nothing caches under these
      // keys for one.
      void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummary(params.year) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.weekendRoster(params.year, params.session_cm_id, scenario.id),
      })
    },
  })
}

export function useDeleteScenario() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (scenarioId: string) => {
      // PocketBase cascades bunk_assignments_draft rows via
      // cascadeDelete: true on the scenario relation (migration
      // 1500000098). One server-side call replaces the previous N+1
      // client-side pre-delete loop that made scenario deletion take
      // several seconds on real sessions.
      return await pb.collection<SavedScenario>('saved_scenarios').delete(scenarioId)
    },
    onSuccess: () => {
      // Invalidate all scenarios queries to refetch
      void queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] })
    },
  })
}
