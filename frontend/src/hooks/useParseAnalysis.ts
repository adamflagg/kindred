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
 * Hook to clear all parse analysis results
 */
export function useClearParseAnalysis() {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => debugService.clearParseAnalysis(fetchWithAuth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parse-analysis'] });
    },
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
