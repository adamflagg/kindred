/**
 * React Query hooks for debug parse analysis
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiWithAuth } from './useApiWithAuth';
import { queryKeys, userDataOptions } from '../utils/queryKeys';
import { debugService } from '../services/debug';
import type {
  ParseAnalysisFilters,
  OriginalRequestsFilters,
  OriginalRequestsWithStatusFilters,
  GroupedRequestsFilters,
  ScopedClearFilters,
  Phase1OnlyRequest,
} from '../services/debug';

/**
 * Hook to fetch parse analysis results with filters
 */
export function useParseAnalysis(filters: ParseAnalysisFilters = {}) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  // Build filter object only with defined values
  const filterArg =
    filters.session_cm_id !== undefined || filters.source_field !== undefined
      ? {
          ...(filters.session_cm_id !== undefined && { sessionCmId: filters.session_cm_id }),
          ...(filters.source_field !== undefined && { sourceField: filters.source_field }),
        }
      : undefined;

  return useQuery({
    queryKey: queryKeys.parseAnalysis(filterArg),
    queryFn: () => debugService.listParseAnalysis(filters, fetchWithAuth),
    enabled: isAuthenticated,
    ...userDataOptions,
  });
}

/**
 * Hook to fetch a single parse analysis detail
 */
export function useParseAnalysisDetail(id: string | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.parseAnalysisDetail(id || ''),
    queryFn: () => {
      if (!id) throw new Error('ID is required');
      return debugService.getParseAnalysisDetail(id, fetchWithAuth);
    },
    enabled: isAuthenticated && !!id,
    ...userDataOptions,
  });
}

/**
 * Hook to fetch original requests for debug selection
 */
export function useOriginalRequests(filters: OriginalRequestsFilters) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  // Build filter object only with defined values
  const filterArg =
    filters.session_cm_id !== undefined || filters.source_field !== undefined
      ? {
          ...(filters.session_cm_id !== undefined && { sessionCmId: filters.session_cm_id }),
          ...(filters.source_field !== undefined && { sourceField: filters.source_field }),
        }
      : undefined;

  return useQuery({
    queryKey: queryKeys.originalRequests(filters.year, filterArg),
    queryFn: () => debugService.listOriginalRequests(filters, fetchWithAuth),
    enabled: isAuthenticated && !!filters.year,
    ...userDataOptions,
  });
}

/**
 * Hook to fetch original requests with parse status (debug/production flags)
 */
export function useOriginalRequestsWithStatus(filters: OriginalRequestsWithStatusFilters) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  // Build filter object only with defined values
  const filterArg =
    filters.session_cm_ids !== undefined || filters.source_field !== undefined
      ? {
          ...(filters.session_cm_ids !== undefined && { sessionCmIds: filters.session_cm_ids }),
          ...(filters.source_field !== undefined && { sourceField: filters.source_field }),
        }
      : undefined;

  return useQuery({
    queryKey: queryKeys.originalRequestsWithStatus(filters.year, filterArg),
    queryFn: () => debugService.listOriginalRequestsWithStatus(filters, fetchWithAuth),
    enabled: isAuthenticated && !!filters.year,
    ...userDataOptions,
  });
}

/**
 * Hook to fetch parse result with fallback (debug -> production -> none)
 */
export function useParseResultWithFallback(originalRequestId: string | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.parseResultWithFallback(originalRequestId || ''),
    queryFn: () => {
      if (!originalRequestId) throw new Error('Original request ID is required');
      return debugService.getParseResultWithFallback(originalRequestId, fetchWithAuth);
    },
    enabled: isAuthenticated && !!originalRequestId,
    ...userDataOptions,
  });
}

/**
 * Hook to run Phase 1 parsing on selected requests
 */
export function useParsePhase1Only() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: Phase1OnlyRequest) =>
      debugService.parsePhase1Only(request, fetchWithAuth),
    onSuccess: () => {
      // Invalidate all parse analysis queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['parse-analysis'] });
    },
  });
}

/**
 * Hook to reparse a single original request
 */
export function useReparseSingle() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (originalRequestId: string) =>
      debugService.parsePhase1Only(
        { original_request_ids: [originalRequestId], force_reparse: true },
        fetchWithAuth
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parse-analysis'] });
    },
  });
}

/**
 * Hook to clear parse analysis results (with optional scoped filters)
 */
export function useClearParseAnalysis() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filters?: ScopedClearFilters) =>
      debugService.clearParseAnalysis(fetchWithAuth, filters),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parse-analysis'] });
      queryClient.invalidateQueries({ queryKey: ['original-requests'] });
      queryClient.invalidateQueries({ queryKey: ['grouped-requests'] });
    },
  });
}

/**
 * Hook to clear a single parse analysis result
 */
export function useClearSingleParseAnalysis() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (originalRequestId: string) =>
      debugService.clearSingleParseAnalysis(originalRequestId, fetchWithAuth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parse-analysis'] });
      queryClient.invalidateQueries({ queryKey: ['original-requests'] });
      queryClient.invalidateQueries({ queryKey: ['grouped-requests'] });
    },
  });
}

/**
 * Hook to fetch original requests grouped by camper
 */
export function useGroupedRequests(filters: GroupedRequestsFilters) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  const filterArg =
    filters.session_cm_ids !== undefined || filters.source_field !== undefined
      ? {
          ...(filters.session_cm_ids !== undefined && { sessionCmIds: filters.session_cm_ids }),
          ...(filters.source_field !== undefined && { sourceField: filters.source_field }),
        }
      : undefined;

  return useQuery({
    queryKey: ['grouped-requests', filters.year, filterArg],
    queryFn: () => debugService.listGroupedRequests(filters, fetchWithAuth),
    enabled: isAuthenticated && !!filters.year,
    ...userDataOptions,
  });
}

// ============================================================================
// Prompt Editor Hooks
// ============================================================================

/**
 * Hook to fetch the list of available prompts
 */
export function usePromptsList() {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.prompts(),
    queryFn: () => debugService.listPrompts(fetchWithAuth),
    enabled: isAuthenticated,
    ...userDataOptions,
  });
}

/**
 * Hook to fetch a specific prompt's content
 */
export function usePrompt(name: string | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.prompt(name || ''),
    queryFn: () => {
      if (!name) throw new Error('Prompt name is required');
      return debugService.getPrompt(name, fetchWithAuth);
    },
    enabled: isAuthenticated && !!name,
    ...userDataOptions,
  });
}

/**
 * Hook to update a prompt's content
 */
export function useUpdatePrompt() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      debugService.updatePrompt(name, content, fetchWithAuth),
    onSuccess: (_data, variables) => {
      // Invalidate both the specific prompt and the list
      queryClient.invalidateQueries({ queryKey: queryKeys.prompt(variables.name) });
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts() });
    },
  });
}
