/**
 * ParseAnalysisTab - Main container for parse analysis debugging
 *
 * Two-panel layout with filters, requester list (left), and detail view (right).
 * Uses fallback pattern: shows debug results if available, otherwise production.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { useYear } from '../../hooks/useCurrentYear';
import { useApiWithAuth } from '../../hooks/useApiWithAuth';
import {
  useOriginalRequestsWithStatus,
  useParseResultWithFallback,
  useParsePhase1Only,
  useClearParseAnalysis,
  useReparseSingle,
} from '../../hooks/useParseAnalysis';
import { queryKeys, syncDataOptions } from '../../utils/queryKeys';
import {
  getDebugDropdownSessions,
  buildAgSessionCmIdMap,
  getEffectiveCmIds,
} from '../../utils/debugParserUtils';

import { ParseAnalysisFilters } from './ParseAnalysisFilters';
import { ParseAnalysisList } from './ParseAnalysisList';
import { ParseAnalysisDetail } from './ParseAnalysisDetail';
import type { OriginalRequestWithStatus, SourceFieldType } from './types';

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

  // Selection state - now tracks original_request_id for fetching parse result with fallback
  const [selectedOriginalRequestId, setSelectedOriginalRequestId] = useState<string | null>(null);
  const [reparsingIds, setReparsingIds] = useState<Set<string>>(new Set());

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

  // Fetch original requests with parse status (for left panel list)
  const {
    data: requestsData,
    isLoading: isLoadingRequests,
    refetch: refetchRequests,
  } = useOriginalRequestsWithStatus({
    year: currentYear,
    session_cm_ids: effectiveCmIds,
    source_field: sourceField ?? undefined,
    limit: 100,
  });

  // Fetch parse result with fallback for selected item (for right panel detail)
  const {
    data: parseResult,
    isLoading: isLoadingDetail,
  } = useParseResultWithFallback(selectedOriginalRequestId);

  // Mutations
  const parsePhase1Mutation = useParsePhase1Only();
  const clearMutation = useClearParseAnalysis();
  const reparseSingleMutation = useReparseSingle();

  // Handle single item reparse
  const handleReparseSingle = async (item: OriginalRequestWithStatus) => {
    const originalId = item.id;
    setReparsingIds((prev) => new Set(prev).add(originalId));

    try {
      await reparseSingleMutation.mutateAsync(originalId);
      toast.success(`Reparsed ${item.requester_name || 'request'}`);
      // Refresh both the list and detail
      await refetchRequests();
    } catch {
      toast.error('Failed to reparse');
    } finally {
      setReparsingIds((prev) => {
        const next = new Set(prev);
        next.delete(originalId);
        return next;
      });
    }
  };

  // Handle detail view reparse (from detail panel)
  const handleDetailReparse = async () => {
    if (!selectedOriginalRequestId || !parseResult) return;
    // Find the item in the list to get the name for toast
    const item = requestsData?.items.find((i) => i.id === selectedOriginalRequestId);
    if (item) {
      await handleReparseSingle(item);
    } else {
      // Fallback: reparse without the full item info
      setReparsingIds((prev) => new Set(prev).add(selectedOriginalRequestId));
      try {
        await reparseSingleMutation.mutateAsync(selectedOriginalRequestId);
        toast.success('Reparsed request');
        await refetchRequests();
      } catch {
        toast.error('Failed to reparse');
      } finally {
        setReparsingIds((prev) => {
          const next = new Set(prev);
          next.delete(selectedOriginalRequestId);
          return next;
        });
      }
    }
  };

  // Handle bulk reparse
  const handleReparseAll = async () => {
    if (!requestsData?.items.length) return;

    const ids = requestsData.items.map((item) => item.id);
    const allIds = new Set(ids);
    setReparsingIds(allIds);

    try {
      await parsePhase1Mutation.mutateAsync({
        original_request_ids: ids,
        force_reparse: true,
      });
      toast.success(`Reparsed ${ids.length} requests`);
      await refetchRequests();
    } catch {
      toast.error('Failed to reparse requests');
    } finally {
      setReparsingIds(new Set());
    }
  };

  // Handle clear all
  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all debug parse analysis results?')) return;

    try {
      const result = await clearMutation.mutateAsync();
      toast.success(`Cleared ${result.deleted_count} debug results`);
      setSelectedOriginalRequestId(null);
      await refetchRequests();
    } catch {
      toast.error('Failed to clear results');
    }
  };

  // Handle selection
  const handleSelect = (item: OriginalRequestWithStatus) => {
    setSelectedOriginalRequestId(item.id);
  };

  const items = requestsData?.items || [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <ParseAnalysisFilters
        sessions={dropdownSessions}
        selectedSessionCmId={sessionCmId}
        onSessionChange={setSessionCmId}
        selectedSourceField={sourceField}
        onSourceFieldChange={setSourceField}
        onReparseSelected={handleReparseAll}
        onClearAll={handleClearAll}
        isReparsing={parsePhase1Mutation.isPending}
        isClearing={clearMutation.isPending}
        selectedCount={items.length}
      />

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left panel: Requester list */}
        <div className="lg:col-span-4">
          <div className="sticky top-24">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              Requesters
              {items.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">
                  {items.length}
                </span>
              )}
            </h3>
            <ParseAnalysisList
              items={items}
              selectedId={selectedOriginalRequestId}
              onSelect={handleSelect}
              onReparse={handleReparseSingle}
              reparsingIds={reparsingIds}
              isLoading={isLoadingRequests}
            />
          </div>
        </div>

        {/* Right panel: Detail view */}
        <div className="lg:col-span-8">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Analysis Detail
          </h3>
          <ParseAnalysisDetail
            item={parseResult || null}
            isLoading={isLoadingDetail}
            onReparse={selectedOriginalRequestId ? handleDetailReparse : undefined}
            isReparsing={selectedOriginalRequestId ? reparsingIds.has(selectedOriginalRequestId) : false}
          />
        </div>
      </div>
    </div>
  );
}
