import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { solverService } from '../services/solver'
import type { ImpossibilityReport } from '../services/solver'
import PreValidationResultsModal from './PreValidationResultsModal'

interface PreValidateRequestsButtonProps {
  sessionCmId: number
  year: number
  className?: string
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  statistics: {
    total_campers: number
    total_bunks: number
    total_capacity: number
    total_requests: number
    campers_with_requests: number
    campers_without_requests: number
  }
  impossibility_report: ImpossibilityReport
}

export default function PreValidateRequestsButton({
  sessionCmId,
  year,
  className = '',
}: PreValidateRequestsButtonProps) {
  const { fetchWithAuth } = useApiWithAuth()
  const [isValidating, setIsValidating] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [validationResults, setValidationResults] = useState<ValidationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePreValidate = async () => {
    setIsValidating(true)
    setError(null)

    try {
      const results = await solverService.preValidateRequests(sessionCmId, year, fetchWithAuth)
      setValidationResults(results)
      setShowResults(true)
    } catch (err) {
      console.error('Pre-validation failed:', err)
      setError(err instanceof Error ? err.message : 'Pre-validation failed')
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <>
      <button
        onClick={handlePreValidate}
        disabled={isValidating}
        className={`btn-accent flex items-center gap-1.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:gap-2 ${className}`}
        title="Pre-check requests for issues before running the solver"
      >
        <ClipboardCheck className="h-4 w-4" />
        <span className="hidden sm:inline">{isValidating ? 'Checking...' : 'Pre-Check'}</span>
        <span className="sm:hidden">{isValidating ? '...' : 'Pre-Check'}</span>
      </button>

      {error && (
        <div className="bg-destructive/10 border-destructive/30 text-destructive mt-2 rounded-xl border p-3 text-sm">
          {error}
        </div>
      )}

      {showResults && validationResults && (
        <PreValidationResultsModal
          isOpen={showResults}
          onClose={() => setShowResults(false)}
          results={validationResults}
          sessionId={sessionCmId.toString()}
        />
      )}
    </>
  )
}
