/**
 * ParseAnalysisTab - Main container for parse analysis debugging
 *
 * Camper-selection model: click a camper to see all their fields (respecting filters).
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
  useClearSingleParseAnalysis,
  useParseResultsBatch,
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
import type { SourceFieldType, FieldParseResult } from './types';

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

  // Selection state - now camper-level instead of field-level
  const [selectedCamperCmId, setSelectedCamperCmId] = useState<number | null>(null);

  // Operation tracking state - now at camper level
  const [reparsingCmIds, setReparsingCmIds] = useState<Set<number>>(new Set());
  const [clearingCmIds, setClearingCmIds] = useState<Set<number>>(new Set());

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
  });

  // Mutations
  const parsePhase1Mutation = useParsePhase1Only();
  const clearMutation = useClearParseAnalysis();
  const clearSingleMutation = useClearSingleParseAnalysis();

  // Get the selected camper's data
  const selectedCamper = useMemo(() => {
    if (!selectedCamperCmId || !groupedData?.items) return null;
    return groupedData.items.find((c) => c.requester_cm_id === selectedCamperCmId) ?? null;
  }, [selectedCamperCmId, groupedData?.items]);

  // Get filtered fields for selected camper (respects sourceField filter)
  const selectedCamperFields: FieldParseResult[] = useMemo(() => {
    if (!selectedCamper) return [];
    // Note: groupedData already filtered by sourceField from API,
    // so selectedCamper.fields should already be filtered
    return selectedCamper.fields;
  }, [selectedCamper]);

  // Get original request IDs for the selected camper's visible fields
  const selectedFieldIds = useMemo(
    () => selectedCamperFields.map((f) => f.original_request_id),
    [selectedCamperFields]
  );

  // Fetch parse results for all visible fields of selected camper (batch call)
  const { data: batchResults, isLoading: isLoadingDetail } = useParseResultsBatch(selectedFieldIds);

  // Map batch results to match the expected format (array aligned with selectedCamperFields)
  const parseResults = useMemo(() => {
    if (!batchResults) return selectedFieldIds.map(() => null);
    // The batch endpoint returns results in the same order as input IDs
    return batchResults;
  }, [batchResults, selectedFieldIds]);

  // Handle camper selection
  const handleCamperSelect = (cmId: number) => {
    setSelectedCamperCmId(cmId);
  };

  // Handle camper-level reparse (reparses all visible fields for that camper)
  const handleReparseCamper = async (cmId: number) => {
    const camper = groupedData?.items.find((c) => c.requester_cm_id === cmId);
    if (!camper) return;

    // Get fields to reparse (already filtered by sourceField from API)
    const ids = camper.fields.map((f) => f.original_request_id);
    if (ids.length === 0) return;

    setReparsingCmIds((prev) => new Set(prev).add(cmId));

    try {
      await parsePhase1Mutation.mutateAsync({
        original_request_ids: ids,
        force_reparse: true,
      });
      toast.success(`Reparsed ${ids.length} field${ids.length !== 1 ? 's' : ''}`);
      await refetchGrouped();
    } catch {
      toast.error('Failed to reparse');
    } finally {
      setReparsingCmIds((prev) => {
        const next = new Set(prev);
        next.delete(cmId);
        return next;
      });
    }
  };

  // Handle camper-level clear (clears all debug results for that camper's visible fields)
  const handleClearCamper = async (cmId: number) => {
    const camper = groupedData?.items.find((c) => c.requester_cm_id === cmId);
    if (!camper) return;

    // Get field IDs with debug results to clear
    const fieldsWithDebug = camper.fields.filter((f) => f.has_debug_result);
    if (fieldsWithDebug.length === 0) return;

    setClearingCmIds((prev) => new Set(prev).add(cmId));

    try {
      // Clear each field's debug result
      await Promise.all(
        fieldsWithDebug.map((f) => clearSingleMutation.mutateAsync(f.original_request_id))
      );
      toast.success(`Cleared ${fieldsWithDebug.length} debug result${fieldsWithDebug.length !== 1 ? 's' : ''}`);
      await refetchGrouped();
    } catch {
      toast.error('Failed to clear debug results');
    } finally {
      setClearingCmIds((prev) => {
        const next = new Set(prev);
        next.delete(cmId);
        return next;
      });
    }
  };

  // Handle bulk reparse (all visible items)
  const handleReparseAll = async () => {
    if (!groupedData?.items.length) return;

    // Collect all original request IDs from visible grouped items
    const ids = groupedData.items.flatMap((camper) =>
      camper.fields.map((f) => f.original_request_id)
    );

    // Track all camper IDs as reparsing
    const allCmIds = new Set(groupedData.items.map((c) => c.requester_cm_id));
    setReparsingCmIds(allCmIds);

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
      setReparsingCmIds(new Set());
    }
  };

  // Handle scoped clear (visible items only)
  const handleClearAll = async () => {
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

  // Handle reparse from detail panel header
  const handleDetailReparse = async () => {
    if (!selectedCamperCmId) return;
    await handleReparseCamper(selectedCamperCmId);
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

      {/* Two-panel layout: Camper list (left) + Detail (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left panel: Camper list (4 cols) */}
        <div className="lg:col-span-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-xl font-display font-bold text-foreground">Campers</h3>
              {groupedData && groupedData.items.length > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-bark-100 dark:bg-bark-800 font-mono text-xs text-muted-foreground">
                  {groupedData.items.length} total
                </span>
              )}
            </div>
          </div>
          <ParseAnalysisGroupedList
            items={groupedData?.items ?? []}
            isLoading={isLoadingGrouped}
            reparsingCmIds={reparsingCmIds}
            clearingCmIds={clearingCmIds}
            onReparseCamper={handleReparseCamper}
            onClearCamper={handleClearCamper}
            searchQuery={searchQuery}
            selectedCamperCmId={selectedCamperCmId}
            onCamperSelect={handleCamperSelect}
          />
        </div>

        {/* Right panel: Multi-field detail view (8 cols) */}
        <div className="lg:col-span-8">
          <ParseAnalysisDetail
            camperName={selectedCamper?.requester_name ?? null}
            camperCmId={selectedCamper?.requester_cm_id ?? null}
            fields={selectedCamperFields}
            parseResults={parseResults}
            isLoading={isLoadingDetail}
            onReparse={handleDetailReparse}
            isReparsing={selectedCamperCmId ? reparsingCmIds.has(selectedCamperCmId) : false}
          />
        </div>
      </div>
    </div>
  );
}
