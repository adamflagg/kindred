import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useScenario } from '../hooks/useScenario'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { solverService } from '../services/solver'
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
  className?: string
}

export default function ValidateBunkingButton({
  sessionCmId,
  year,
  className = '',
}: ValidateBunkingButtonProps) {
  const { currentScenario } = useScenario()
  const { fetchWithAuth } = useApiWithAuth()
  const [isValidating, setIsValidating] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [validationResults, setValidationResults] = useState<ValidationResults | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pre-check report drives the "campers with impossible requests" section in
  // the post-check modal (#1442 part 2). Shared query key with the session-
  // header pre-check + SolverDebugPage — so if either has populated cache, we
  // serve instantly; otherwise we fetch on demand. Impossibility is an input-
  // feasibility property, so the report is valid regardless of solver state —
  // long staleTime + no refetch-on-focus keeps the cache warm and avoids
  // duplicate fetches while the user moves between tabs.
  const preCheckQuery = useQuery({
    queryKey: queryKeys.preCheck(sessionCmId, year),
    queryFn: () => solverService.preValidateRequests(sessionCmId, year, fetchWithAuth),
    enabled: showResults,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const handleValidate = async () => {
    setIsValidating(true)
    setError(null)

    try {
      const results = await solverService.validateBunking(
        sessionCmId.toString(),
        year,
        currentScenario?.id,
        fetchWithAuth
      )
      setValidationResults(results as unknown as ValidationResults)
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
          {...(currentScenario?.id && { scenarioId: currentScenario.id })}
          {...(preCheckQuery.data?.impossibility_report && {
            impossibilityReport: preCheckQuery.data.impossibility_report,
          })}
        />
      )}
    </>
  )
}
