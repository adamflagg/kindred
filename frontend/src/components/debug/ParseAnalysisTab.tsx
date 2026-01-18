/**
 * ParseAnalysisTab - Main container for parse analysis debugging
 *
 * Accordion grouped UI showing campers with their field requests as nested blocks.
 * Uses fallback pattern: shows debug results if available, otherwise production.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { useYear } from '../../hooks/useCurrentYear';
import { useApiWithAuth } from '../../hooks/useApiWithAuth';
import {
  useGroupedRequests,
  useParsePhase1Only,
  useClearParseAnalysis,
  useReparseSingle,
  useClearSingleParseAnalysis,
  useParseResultWithFallback,
} from '../../hooks/useParseAnalysis';
import { queryKeys, syncDataOptions } from '../../utils/queryKeys';
import {
  getDebugDropdownSessions,
  buildAgSessionCmIdMap,
  getEffectiveCmIds,
} from '../../utils/debugParserUtils';

import { ParseAnalysisFilters } from './ParseAnalysisFilters';
import { ParseAnalysisGroupedList } from './ParseAnalysisGroupedList';
import { ParseAnalysisDetail } from './ParseAnalysisDetail';
import type { SourceFieldType } from './types';

interface Session {
  id: string;
  cm_id: number;
  name: string;
  session_type?: string;
  parent_id?: number | null;
}

export function ParseAnalysisTab() {
  const currentYear = useYear();
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  // Filter state
  const [sessionCmId, setSessionCmId] = useState<number | null>(null);
  const [sourceField, setSourceField] = useState<SourceFieldType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Selection state for detail panel
  const [selectedOriginalRequestId, setSelectedOriginalRequestId] = useState<string | null>(null);

  // Operation tracking state
  const [reparsingIds, setReparsingIds] = useState<Set<string>>(new Set());
  const [clearingIds, setClearingIds] = useState<Set<string>>(new Set());

  // Fetch all summer camp sessions (main + ag + embedded)
  const { data: allSessions = [] } = useQuery<Session[]>({
    queryKey: [...queryKeys.sessions(currentYear), 'debug-filter'],
    queryFn: async () => {
      const filter = encodeURIComponent(
        `(session_type = "main" || session_type = "ag" || session_type = "embedded") && year = ${currentYear}`
      );
      const res = await fetchWithAuth(
        `/api/collections/camp_sessions/records?filter=${filter}&sort=name`
      );
      if (!res.ok) throw new Error('Failed to fetch sessions');
      const data = await res.json();
      return data.items || [];
    },
    enabled: isAuthenticated,
    ...syncDataOptions,
  });

  // Filter sessions for dropdown (main + embedded only, AG excluded)
  const dropdownSessions = useMemo(
    () => getDebugDropdownSessions(allSessions),
    [allSessions]
  );

  // Build AG session cm_id mapping (main cm_id -> [ag cm_ids])
  const agSessionMap = useMemo(() => buildAgSessionCmIdMap(allSessions), [allSessions]);

  // Get effective cm_ids for API call (includes AG children for main sessions)
  const effectiveCmIds = useMemo(
    () => getEffectiveCmIds(sessionCmId, agSessionMap),
    [sessionCmId, agSessionMap]
  );

  // Fetch grouped requests (campers with their fields)
  const {
    data: groupedData,
    isLoading: isLoadingGrouped,
    refetch: refetchGrouped,
  } = useGroupedRequests({
    year: currentYear,
    session_cm_ids: effectiveCmIds,
    source_field: sourceField ?? undefined,
    limit: 100,
  });

  // Mutations
  const parsePhase1Mutation = useParsePhase1Only();
  const clearMutation = useClearParseAnalysis();
  const reparseSingleMutation = useReparseSingle();
  const clearSingleMutation = useClearSingleParseAnalysis();

  // Fetch parse result for selected field (detail panel)
  const { data: selectedParseResult, isLoading: isLoadingDetail } =
    useParseResultWithFallback(selectedOriginalRequestId);

  // Handle field selection from grouped list
  const handleFieldSelect = (originalRequestId: string) => {
    setSelectedOriginalRequestId(originalRequestId);
  };

  // Handle single item reparse
  const handleReparseSingle = async (originalRequestId: string) => {
    setReparsingIds((prev) => new Set(prev).add(originalRequestId));

    try {
      await reparseSingleMutation.mutateAsync(originalRequestId);
      toast.success('Reparsed successfully');
      await refetchGrouped();
    } catch {
      toast.error('Failed to reparse');
    } finally {
      setReparsingIds((prev) => {
        const next = new Set(prev);
        next.delete(originalRequestId);
        return next;
      });
    }
  };

  // Handle single item clear
  const handleClearSingle = async (originalRequestId: string) => {
    setClearingIds((prev) => new Set(prev).add(originalRequestId));

    try {
      await clearSingleMutation.mutateAsync(originalRequestId);
      toast.success('Cleared debug result');
      await refetchGrouped();
    } catch {
      toast.error('Failed to clear');
    } finally {
      setClearingIds((prev) => {
        const next = new Set(prev);
        next.delete(originalRequestId);
        return next;
      });
    }
  };

  // Handle bulk reparse (visible items only)
  const handleReparseAll = async () => {
    if (!groupedData?.items.length) return;

    // Collect all original request IDs from visible grouped items
    const ids = groupedData.items.flatMap((camper) =>
      camper.fields.map((f) => f.original_request_id)
    );
    const allIds = new Set(ids);
    setReparsingIds(allIds);

    try {
      await parsePhase1Mutation.mutateAsync({
        original_request_ids: ids,
        force_reparse: true,
      });
      toast.success(`Reparsed ${ids.length} requests`);
      await refetchGrouped();
    } catch {
      toast.error('Failed to reparse requests');
    } finally {
      setReparsingIds(new Set());
    }
  };

  // Handle scoped clear (visible items only)
  const handleClearAll = async () => {
    // Build scoped filters based on current filter state
    const scopedFilters = {
      session_cm_ids: effectiveCmIds,
      source_field: sourceField ?? undefined,
    };

    const hasFilters = effectiveCmIds || sourceField;
    const confirmMessage = hasFilters
      ? 'Are you sure you want to clear debug results for the current filtered view?'
      : 'Are you sure you want to clear ALL debug parse analysis results?';

    if (!confirm(confirmMessage)) return;

    try {
      const result = await clearMutation.mutateAsync(scopedFilters);
      toast.success(`Cleared ${result.deleted_count} debug results`);
      await refetchGrouped();
    } catch {
      toast.error('Failed to clear results');
    }
  };

  // Count total fields for display
  const totalFields = useMemo(
    () => groupedData?.items.reduce((sum, camper) => sum + camper.fields.length, 0) ?? 0,
    [groupedData?.items]
  );

  // Handle reparse from detail panel (updates selection after reparse)
  const handleDetailReparse = async () => {
    if (!selectedOriginalRequestId) return;
    await handleReparseSingle(selectedOriginalRequestId);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <ParseAnalysisFilters
        sessions={dropdownSessions}
        selectedSessionCmId={sessionCmId}
        onSessionChange={setSessionCmId}
        selectedSourceField={sourceField}
        onSourceFieldChange={setSourceField}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onReparseSelected={handleReparseAll}
        onClearAll={handleClearAll}
        isReparsing={parsePhase1Mutation.isPending}
        isClearing={clearMutation.isPending}
        selectedCount={totalFields}
      />

      {/* Two-panel layout: Grouped accordion (left) + Detail (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left panel: Grouped accordion (4 cols) */}
        <div className="lg:col-span-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            Campers
            {groupedData && groupedData.items.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">
                {groupedData.items.length} camper{groupedData.items.length !== 1 ? 's' : ''}, {totalFields} field{totalFields !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <ParseAnalysisGroupedList
            items={groupedData?.items ?? []}
            isLoading={isLoadingGrouped}
            reparsingIds={reparsingIds}
            clearingIds={clearingIds}
            onReparse={handleReparseSingle}
            onClear={handleClearSingle}
            searchQuery={searchQuery}
            selectedFieldId={selectedOriginalRequestId}
            onFieldSelect={handleFieldSelect}
          />
        </div>

        {/* Right panel: Detail view (8 cols) */}
        <div className="lg:col-span-8">
          <ParseAnalysisDetail
            item={selectedParseResult ?? null}
            isLoading={isLoadingDetail}
            onReparse={handleDetailReparse}
            isReparsing={selectedOriginalRequestId ? reparsingIds.has(selectedOriginalRequestId) : false}
          />
        </div>
      </div>
    </div>
  );
}
