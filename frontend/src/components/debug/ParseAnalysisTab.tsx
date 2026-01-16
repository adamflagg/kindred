/**
 * ParseAnalysisTab - Main container for parse analysis debugging
 *
 * Two-panel layout with filters, requester list (left), and detail view (right).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { useYear } from '../../hooks/useCurrentYear';
import { useApiWithAuth } from '../../hooks/useApiWithAuth';
import {
  useParseAnalysis,
  useParsePhase1Only,
  useClearParseAnalysis,
  useReparseSingle,
} from '../../hooks/useParseAnalysis';
import { queryKeys, syncDataOptions } from '../../utils/queryKeys';

import { ParseAnalysisFilters } from './ParseAnalysisFilters';
import { ParseAnalysisList } from './ParseAnalysisList';
import { ParseAnalysisDetail } from './ParseAnalysisDetail';
import type { ParseAnalysisItem, SourceFieldType } from './types';

interface Session {
  id: string;
  cm_id: number;
  name: string;
}

export function ParseAnalysisTab() {
  const currentYear = useYear();
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth();

  // Filter state
  const [sessionCmId, setSessionCmId] = useState<number | null>(null);
  const [sourceField, setSourceField] = useState<SourceFieldType | null>(null);

  // Selection state
  const [selectedItem, setSelectedItem] = useState<ParseAnalysisItem | null>(null);
  const [reparsingIds, setReparsingIds] = useState<Set<string>>(new Set());

  // Fetch sessions for filter dropdown
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: queryKeys.sessions(currentYear),
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/collections/camp_sessions/records?filter=(year=${currentYear})&sort=name`
      );
      if (!res.ok) throw new Error('Failed to fetch sessions');
      const data = await res.json();
      return data.items || [];
    },
    enabled: isAuthenticated,
    ...syncDataOptions,
  });

  // Fetch parse analysis results
  const {
    data: analysisData,
    isLoading: isLoadingAnalysis,
    refetch: refetchAnalysis,
  } = useParseAnalysis({
    session_cm_id: sessionCmId ?? undefined,
    source_field: sourceField ?? undefined,
    limit: 100,
  });

  // Mutations
  const parsePhase1Mutation = useParsePhase1Only();
  const clearMutation = useClearParseAnalysis();
  const reparseSingleMutation = useReparseSingle();

  // Handle single item reparse
  const handleReparseSingle = async (item: ParseAnalysisItem) => {
    const originalId = item.original_request_id;
    setReparsingIds((prev) => new Set(prev).add(originalId));

    try {
      await reparseSingleMutation.mutateAsync(originalId);
      toast.success(`Reparsed ${item.requester_name || 'request'}`);
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
    if (!selectedItem) return;
    await handleReparseSingle(selectedItem);
    // Refresh the selected item data
    const updatedData = await refetchAnalysis();
    const updated = updatedData.data?.items.find((i) => i.id === selectedItem.id);
    if (updated) setSelectedItem(updated);
  };

  // Handle bulk reparse
  const handleReparseAll = async () => {
    if (!analysisData?.items.length) return;

    const ids = analysisData.items.map((item) => item.original_request_id);
    const allIds = new Set(ids);
    setReparsingIds(allIds);

    try {
      await parsePhase1Mutation.mutateAsync({
        original_request_ids: ids,
        force_reparse: true,
      });
      toast.success(`Reparsed ${ids.length} requests`);
    } catch {
      toast.error('Failed to reparse requests');
    } finally {
      setReparsingIds(new Set());
    }
  };

  // Handle clear all
  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all parse analysis results?')) return;

    try {
      const result = await clearMutation.mutateAsync();
      toast.success(`Cleared ${result.deleted_count} results`);
      setSelectedItem(null);
    } catch {
      toast.error('Failed to clear results');
    }
  };

  // Handle selection
  const handleSelect = (item: ParseAnalysisItem) => {
    setSelectedItem(item);
  };

  const items = analysisData?.items || [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <ParseAnalysisFilters
        sessions={sessions}
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
              selectedId={selectedItem?.id || null}
              onSelect={handleSelect}
              onReparse={handleReparseSingle}
              reparsingIds={reparsingIds}
              isLoading={isLoadingAnalysis}
            />
          </div>
        </div>

        {/* Right panel: Detail view */}
        <div className="lg:col-span-8">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Analysis Detail
          </h3>
          <ParseAnalysisDetail
            item={selectedItem}
            onReparse={selectedItem ? handleDetailReparse : undefined}
            isReparsing={selectedItem ? reparsingIds.has(selectedItem.original_request_id) : false}
          />
        </div>
      </div>
    </div>
  );
}
