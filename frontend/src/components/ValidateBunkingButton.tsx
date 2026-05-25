import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useScenario } from '../hooks/useScenario'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { solverService, type PreCheckCacheValue } from '../services/solver'
import { queryKeys } from '../utils/queryKeys'
import PostValidationResultsModal from './PostValidationResultsModal'

interface ValidationResults {
  statistics: {
    total_campers: number
    assigned_campers: number
    unassigned_campers: number
    total_requests: number
    satisfied_requests: number
    request_satisfaction_rate: number
    bunks_at_capacity: number
    bunks_under_capacity: number
    bunks_over_capacity: number

    field_stats: Record<
      string,
      {
        total: number
        satisfied: number
        satisfaction_rate: number
      }
    >
  }
  issues: Array<{
    type: string
    severity: string
    message: string
    details?: Record<string, unknown>
  }>
  validated_at: string
}

interface ValidateBunkingButtonProps {
  sessionCmId: number
  year: number
  sessionName?: string
  className?: string
}

export default function ValidateBunkingButton({
  sessionCmId,
  year,
  sessionName,
  className = '',
}: ValidateBunkingButtonProps) {
  const { currentScenario } = useScenario()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [isValidating, setIsValidating] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scenarioId = currentScenario?.id

  // Post-check validation results — stored in the React Query cache so that
  // mutations (drag-drop, approve/decline) can invalidate and trigger a
  // refetch while the modal is open. #1607 / #1608.
  //
  // enabled: only fetch reactively (after invalidation) while the modal is
  // visible; the initial data is seeded imperatively in handleValidate below
  // via setQueryData so the modal opens immediately without a second round-trip.
  const postCheckQuery = useQuery<ValidationResults>({
    queryKey: queryKeys.postCheck(sessionCmId, year, scenarioId),
    queryFn: () =>
      solverService.validateBunking(
        sessionCmId.toString(),
        year,
        scenarioId,
        fetchWithAuth
      ) as unknown as Promise<ValidationResults>,
    enabled: showResults,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // The validation results displayed in the modal: prefer live query data
  // (which refreshes on invalidation), fall back to the last fetched value.
  const validationResults = postCheckQuery.data ?? null

  // Pre-check report drives the "campers with impossible requests" section in
  // the post-check modal (#1442 part 2). Shared query key with the session-
  // header pre-check + SolverDebugPage — so if either has populated cache, we
  // serve instantly; otherwise we fetch on demand. Impossibility is an input-
  // feasibility property, so the report is valid regardless of solver state —
  // long staleTime + no refetch-on-focus keeps the cache warm and avoids
  // duplicate fetches while the user moves between tabs.
  const preCheckQuery = useQuery<PreCheckCacheValue>({
    queryKey: queryKeys.preCheck(sessionCmId, year),
    queryFn: () => solverService.preValidateRequests(sessionCmId, year, fetchWithAuth),
    enabled: showResults,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const handleValidate = async () => {
    setIsValidating(true)
    setError(null)

    try {
      const results = await solverService.validateBunking(
        sessionCmId.toString(),
        year,
        scenarioId,
        fetchWithAuth
      )
      // Seed the React Query cache immediately so the modal shows data without
      // waiting for a second fetch. Subsequent invalidations (drag-drop,
      // approve/decline) will trigger a background refetch via the useQuery
      // above while the modal stays open. #1607 / #1608.
      queryClient.setQueryData<ValidationResults>(
        queryKeys.postCheck(sessionCmId, year, scenarioId),
        results as unknown as ValidationResults
      )
      setShowResults(true)
    } catch (err) {
      console.error('Validation failed:', err)
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <>
      <button
        onClick={handleValidate}
        disabled={isValidating}
        className={`btn-secondary flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <CheckCircle className="h-4 w-4" />
        <span className="hidden sm:inline">{isValidating ? 'Checking...' : 'Check Bunking'}</span>
        <span className="sm:hidden">{isValidating ? 'Checking...' : 'Check'}</span>
      </button>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showResults && validationResults && (
        <PostValidationResultsModal
          isOpen={showResults}
          onClose={() => setShowResults(false)}
          results={validationResults}
          sessionCmId={sessionCmId}
          scenarioId={currentScenario?.id}
          impossibilityReport={preCheckQuery.data?.impossibility_report}
          preCheckError={preCheckQuery.isError}
          sessionName={sessionName}
          year={year}
          isRefreshing={postCheckQuery.isFetching && !postCheckQuery.isLoading}
        />
      )}
    </>
  )
}
