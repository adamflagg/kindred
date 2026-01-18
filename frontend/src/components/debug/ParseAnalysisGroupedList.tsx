/**
 * ParseAnalysisGroupedList - Accordion list grouped by camper
 *
 * Shows campers as expandable rows with their field requests as nested blocks.
 * Each camper row shows name and field badges as preview.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Loader2, User } from 'lucide-react';
import { CamperFieldBlock } from './CamperFieldBlock';
import { useParseResultWithFallback } from '../../hooks/useParseAnalysis';
import { SOURCE_FIELD_LABELS } from './types';
import type {
  CamperGroupedRequests,
  FieldParseResult,
  SourceFieldType,
} from './types';

interface ParseAnalysisGroupedListProps {
  items: CamperGroupedRequests[];
  isLoading: boolean;
  reparsingIds: Set<string>;
  clearingIds: Set<string>;
  onReparse: (originalRequestId: string) => void;
  onClear: (originalRequestId: string) => void;
  searchQuery: string;
}

// Small badge component for field preview in collapsed row
function FieldBadge({ field }: { field: FieldParseResult }) {
  const label =
    SOURCE_FIELD_LABELS[field.source_field as SourceFieldType] || field.source_field;

  const colorClass = (() => {
    switch (field.source_field) {
      case 'bunk_with':
        return 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400';
      case 'not_bunk_with':
        return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400';
      case 'bunking_notes':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
      case 'internal_notes':
        return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400';
      default:
        return 'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400';
    }
  })();

  // Show status indicator
  const statusDot = field.has_debug_result
    ? 'bg-amber-500'
    : field.has_production_result
      ? 'bg-forest-500'
      : 'bg-bark-300';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold
        ${colorClass}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
      {label}
    </span>
  );
}

// Component to render expanded camper content with field blocks
function CamperExpandedContent({
  camper,
  reparsingIds,
  clearingIds,
  onReparse,
  onClear,
}: {
  camper: CamperGroupedRequests;
  reparsingIds: Set<string>;
  clearingIds: Set<string>;
  onReparse: (originalRequestId: string) => void;
  onClear: (originalRequestId: string) => void;
}) {
  // Track which field is expanded to fetch its parse result
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);

  // Fetch parse result for the expanded field
  const { data: parseResult, isLoading: isLoadingDetail } =
    useParseResultWithFallback(expandedFieldId);

  return (
    <div className="space-y-3 p-4 pt-0">
      {camper.fields.map((field) => (
        <CamperFieldBlock
          key={field.original_request_id}
          field={field}
          parseResult={
            expandedFieldId === field.original_request_id ? parseResult ?? null : null
          }
          isLoadingDetail={
            expandedFieldId === field.original_request_id && isLoadingDetail
          }
          isReparsing={reparsingIds.has(field.original_request_id)}
          isClearing={clearingIds.has(field.original_request_id)}
          onReparse={() => onReparse(field.original_request_id)}
          onClear={() => onClear(field.original_request_id)}
          onExpand={() => setExpandedFieldId(field.original_request_id)}
          isExpanded={expandedFieldId === field.original_request_id}
        />
      ))}
    </div>
  );
}

export function ParseAnalysisGroupedList({
  items,
  isLoading,
  reparsingIds,
  clearingIds,
  onReparse,
  onClear,
  searchQuery,
}: ParseAnalysisGroupedListProps) {
  const [expandedCampers, setExpandedCampers] = useState<Set<number>>(new Set());

  const toggleCamper = useCallback((cmId: number) => {
    setExpandedCampers((prev) => {
      const next = new Set(prev);
      if (next.has(cmId)) {
        next.delete(cmId);
      } else {
        next.add(cmId);
      }
      return next;
    });
  }, []);

  // Filter by search query
  const filteredItems = searchQuery
    ? items.filter((item) =>
        item.requester_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  if (isLoading) {
    return (
      <div className="card-lodge flex items-center justify-center h-64 bg-parchment-100/30 dark:bg-bark-900/20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-forest-600" />
          <span className="text-sm text-muted-foreground">Loading requests...</span>
        </div>
      </div>
    );
  }

  if (filteredItems.length === 0) {
    return (
      <div className="card-lodge flex items-center justify-center h-64 bg-parchment-100/30 dark:bg-bark-900/20">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <div className="w-14 h-14 rounded-2xl bg-bark-100 dark:bg-bark-800 flex items-center justify-center">
            <User className="w-7 h-7 text-bark-400" />
          </div>
          <div className="text-center">
            <span className="text-sm font-semibold text-foreground">No results found</span>
            <p className="text-xs mt-1">Try adjusting your filters</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-lodge p-2 bg-parchment-100/30 dark:bg-bark-900/20">
      <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1 custom-scrollbar">
        {filteredItems.map((camper) => {
          const isExpanded = expandedCampers.has(camper.requester_cm_id);

          return (
            <div
              key={camper.requester_cm_id}
              className={`
                rounded-xl border-2 transition-all duration-200
                ${
                  isExpanded
                    ? 'bg-white dark:bg-bark-800 border-forest-200 dark:border-forest-700 shadow-sm'
                    : 'bg-white dark:bg-bark-800 border-transparent hover:border-bark-200 dark:hover:border-bark-600'
                }
              `}
            >
              {/* Camper row header */}
              <button
                onClick={() => toggleCamper(camper.requester_cm_id)}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                {/* Expand/collapse indicator */}
                <div className="flex-shrink-0 text-bark-400">
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </div>

                {/* Camper name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-foreground truncate">
                      {camper.requester_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({camper.fields.length} field{camper.fields.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                </div>

                {/* Field badges preview (collapsed only) */}
                {!isExpanded && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {camper.fields.map((field) => (
                      <FieldBadge key={field.original_request_id} field={field} />
                    ))}
                  </div>
                )}
              </button>

              {/* Expanded content with field blocks */}
              {isExpanded && (
                <CamperExpandedContent
                  camper={camper}
                  reparsingIds={reparsingIds}
                  clearingIds={clearingIds}
                  onReparse={onReparse}
                  onClear={onClear}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
