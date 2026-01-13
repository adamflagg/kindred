import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { useScenario } from '../hooks/useScenario';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import { solverService } from '../services/solver';
import PostValidationResultsModal from './PostValidationResultsModal';

interface ValidationResults {
  statistics: {
    total_campers: number;
    assigned_campers: number;
    unassigned_campers: number;
    total_requests: number;
    satisfied_requests: number;
    request_satisfaction_rate: number;
    bunks_at_capacity: number;
    bunks_under_capacity: number;
    bunks_over_capacity: number;

    field_stats: Record<string, {
      total: number;
      satisfied: number;
      satisfaction_rate: number;
    }>;
  };
  issues: Array<{
    type: string;
    severity: string;
    message: string;
    details?: Record<string, unknown>;
  }>;
  validated_at: string;
}

interface ValidateBunkingButtonProps {
  sessionCmId: number;
  year: number;
  className?: string;
}

export default function ValidateBunkingButton({ sessionCmId, year, className = '' }: ValidateBunkingButtonProps) {
  const { currentScenario } = useScenario();
  const { fetchWithAuth } = useApiWithAuth();
  const [isValidating, setIsValidating] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [validationResults, setValidationResults] = useState<ValidationResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    setIsValidating(true);
    setError(null);
    
    try {
      const results = await solverService.validateBunking(sessionCmId.toString(), year, currentScenario?.id, fetchWithAuth);
      setValidationResults(results as unknown as ValidationResults);
      setShowResults(true);
    } catch (err) {
      console.error('Validation failed:', err);
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <>
      <button
        onClick={handleValidate}
        disabled={isValidating}
        className={`btn-secondary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${className}`}
      >
        <CheckCircle className="h-4 w-4" />
        <span className="hidden sm:inline">
          {isValidating ? 'Checking...' : 'Check Bunking'}
        </span>
        <span className="sm:hidden">
          {isValidating ? 'Checking...' : 'Check'}
        </span>
      </button>

      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showResults && validationResults && (
        <PostValidationResultsModal
          isOpen={showResults}
          onClose={() => setShowResults(false)}
          results={validationResults}
          sessionId={sessionCmId.toString()}
          {...(currentScenario?.id && { scenarioId: currentScenario.id })}
        />
      )}
    </>
  );
}