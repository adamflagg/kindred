/**
 * Hook for managing solver operations (run, apply, clear)
 * Extracted from SessionView.tsx
 *
 * This hook encapsulates:
 * - Running the solver
 * - Auto-applying results
 * - Clearing scenario assignments
 * - Error handling with helpful messages
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { solverService } from '../../services/solver';
import { graphCacheService } from '../../services/GraphCacheService';

/** Type for fetchWithAuth function from useApiWithAuth */
export type FetchWithAuthFn = (
  url: string,
  options?: RequestInit & { skipAuth?: boolean }
) => Promise<Response>;

export interface SolverStats {
  satisfied_request_count?: number;
  satisfied_constraints?: number;
  total_requests?: number;
  total_constraints?: number;
  assignments_changed?: number;
  new_assignments?: number;
  request_validation?: {
    impossible_requests: number;
    affected_campers: number;
  };
}

export interface SolverRunResult {
  id: string;
  status: 'completed' | 'failed' | 'pending' | 'running';
  error_message?: string;
  results?: {
    stats?: SolverStats;
  };
}

interface ScenarioOption {
  id: string;
  name: string;
}

export interface UseSolverOperationsOptions {
  selectedSession: string;
  currentYear: number;
  currentScenario: ScenarioOption | null;
  scenarios: ScenarioOption[];
  autoApplyEnabled: boolean;
  autoApplyTimeout: number;
  fetchWithAuth: FetchWithAuthFn;
}

export interface SolverRunResultWithStats {
  success: boolean;
  stats?: SolverStats | undefined;
  errorMessage?: string | undefined;
}

export interface UseSolverOperationsReturn {
  /** Whether solver is currently running */
  isSolving: boolean;
  /** Whether results are being applied */
  isApplyingResults: boolean;
  /** Captured scenario ID during solver run (for UI indicator) */
  capturedScenarioId: string | null;
  /** Run the solver and optionally auto-apply results. Returns stats on success. */
  handleRunSolver: (timeLimit?: number) => Promise<SolverRunResultWithStats>;
  /** Clear all assignments in the current scenario */
  handleClearAssignments: () => Promise<void>;
  /** Whether clearing is possible (only in scenario mode) */
  canClearAssignments: boolean;
}

export function useSolverOperations({
  selectedSession,
  currentYear,
  currentScenario,
  scenarios: _scenarios,
  autoApplyEnabled,
  autoApplyTimeout,
  fetchWithAuth,
}: UseSolverOperationsOptions): UseSolverOperationsReturn {
  const queryClient = useQueryClient();
  const [isSolving, setIsSolving] = useState(false);
  const [isApplyingResults, setIsApplyingResults] = useState(false);
  const [capturedScenarioId, setCapturedScenarioId] = useState<string | null>(null);

  const canClearAssignments = currentScenario !== null;

  const handleRunSolver = useCallback(async (timeLimit: number = 60): Promise<SolverRunResultWithStats> => {
    setIsSolving(true);

    // Capture the current scenario ID at the start of solving
    const solverScenarioId = currentScenario?.id || null;
    setCapturedScenarioId(solverScenarioId);

    try {
      const solverRun = await solverService.runSolver(
        selectedSession,
        currentYear,
        solverScenarioId,
        fetchWithAuth,
        timeLimit
      );

      if (solverRun.status === 'completed') {
        const stats = solverRun.results?.stats;

        // Store stats to return
        const resultStats = stats;

        // Auto-apply results if enabled
        if (autoApplyEnabled) {
          const applyResults = async () => {
            setIsApplyingResults(true);

            try {
              await solverService.applySolverResults(solverRun.id, fetchWithAuth);

              // Invalidate all related queries to force refresh
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ['campers', selectedSession],
                }),
                queryClient.invalidateQueries({
                  queryKey: ['bunks', selectedSession],
                }),
                queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] }),
                queryClient.invalidateQueries({ queryKey: ['all-sessions'] }),
              ]);
            } catch (applyError) {
              console.error('Failed to apply solver results:', applyError);
            } finally {
              setIsApplyingResults(false);
              setCapturedScenarioId(null);
            }
          };

          // Apply with timeout if configured
          if (autoApplyTimeout > 0) {
            setTimeout(applyResults, autoApplyTimeout * 1000);
          } else {
            await applyResults();
          }
        } else {
          // Legacy behavior - ask to apply
          if (confirm('Apply results? This will update all camper assignments.')) {
            setIsApplyingResults(true);

            try {
              await solverService.applySolverResults(solverRun.id, fetchWithAuth);

              // Invalidate all related queries to force refresh
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ['campers', selectedSession],
                }),
                queryClient.invalidateQueries({
                  queryKey: ['bunks', selectedSession],
                }),
                queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] }),
                queryClient.invalidateQueries({ queryKey: ['all-sessions'] }),
              ]);
            } catch (applyError) {
              console.error('Failed to apply solver results:', applyError);
            } finally {
              setIsApplyingResults(false);
            }
          }
        }

        // Return success with stats
        return { success: true, stats: resultStats };
      } else {
        const errorMessage = solverRun.error_message || 'Optimization failed';
        return { success: false, errorMessage };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to run optimizer';
      console.error('Solver error:', error);
      return { success: false, errorMessage };
    } finally {
      setIsSolving(false);
      if (!autoApplyEnabled) {
        setCapturedScenarioId(null);
      }
    }
  }, [
    selectedSession,
    currentYear,
    currentScenario,
    autoApplyEnabled,
    autoApplyTimeout,
    fetchWithAuth,
    queryClient,
  ]);

  const handleClearAssignments = useCallback(async () => {
    if (!currentScenario) return;

    try {
      const result = await solverService.clearScenarioAssignments(
        currentScenario.id,
        currentYear,
        fetchWithAuth
      );

      // Invalidate graph cache for the session
      const sessionCmId = parseInt(selectedSession, 10);
      if (!isNaN(sessionCmId)) {
        graphCacheService.invalidate(sessionCmId);
      }

      // Invalidate queries to refresh the UI
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['campers', selectedSession],
        }),
        queryClient.invalidateQueries({
          queryKey: ['bunks', selectedSession],
        }),
      ]);

      const message = result.message || 'Assignments cleared successfully';
      toast.success(message);
    } catch (error) {
      console.error('Failed to clear assignments:', error);
      toast.error('Failed to clear assignments');
    }
  }, [currentScenario, currentYear, selectedSession, fetchWithAuth, queryClient]);

  return {
    isSolving,
    isApplyingResults,
    capturedScenarioId,
    handleRunSolver,
    handleClearAssignments,
    canClearAssignments,
  };
}
