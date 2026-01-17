/**
 * ParseAnalysisList - Left panel with requester list and selection
 *
 * Shows a scrollable list of requesters with their parse status.
 * Each row has a per-row reprocess button.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { CheckCircle, Loader2, RefreshCw, User, XCircle } from 'lucide-react';
import { SOURCE_FIELD_LABELS } from './types';
import type { ParseAnalysisItem, SourceFieldType } from './types';

interface ParseAnalysisListProps {
  items: ParseAnalysisItem[];
  selectedId: string | null;
  onSelect: (item: ParseAnalysisItem) => void;
  onReparse: (item: ParseAnalysisItem) => void;
  reparsingIds: Set<string>;
  isLoading?: boolean;
}

export function ParseAnalysisList({
  items,
  selectedId,
  onSelect,
  onReparse,
  reparsingIds,
  isLoading,
}: ParseAnalysisListProps) {
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

  if (items.length === 0) {
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
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
        {items.map((item) => {
          const isSelected = item.id === selectedId;
          const isReparsing = reparsingIds.has(item.original_request_id);
          const sourceLabel =
            SOURCE_FIELD_LABELS[item.source_field as SourceFieldType] ||
            item.source_field ||
            'Unknown';

          return (
            <div
              key={item.id}
              className={`
                group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer
                transition-all duration-200 border-2
                ${
                  isSelected
                    ? 'bg-forest-50 dark:bg-forest-900/30 border-forest-300 dark:border-forest-700 shadow-sm'
                    : 'bg-white dark:bg-bark-800 border-transparent hover:bg-parchment-200/70 dark:hover:bg-bark-700/50 hover:border-bark-200 dark:hover:border-bark-600'
                }
              `}
              onClick={() => onSelect(item)}
            >
              {/* Selection indicator */}
              <div
                className={`
                  w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                  transition-all duration-200
                  ${isSelected ? 'border-forest-500 bg-forest-500' : 'border-bark-300 dark:border-bark-600'}
                `}
              >
                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground truncate">
                    {item.requester_name || 'Unknown'}
                  </span>
                  {item.is_valid ? (
                    <CheckCircle className="w-3.5 h-3.5 text-forest-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`
                      inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold
                      ${item.source_field === 'bunk_with' ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400' : ''}
                      ${item.source_field === 'not_bunk_with' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' : ''}
                      ${item.source_field === 'bunking_notes' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : ''}
                      ${item.source_field === 'internal_notes' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' : ''}
                    `}
                  >
                    {sourceLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.parsed_intents.length} intent{item.parsed_intents.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Reparse button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReparse(item);
                }}
                disabled={isReparsing}
                className={`
                  p-2 rounded-lg transition-all duration-200 flex-shrink-0
                  ${
                    isReparsing
                      ? 'bg-forest-100 dark:bg-forest-900/30'
                      : 'opacity-0 group-hover:opacity-100 bg-bark-100 dark:bg-bark-700 hover:bg-forest-100 dark:hover:bg-forest-900/30'
                  }
                `}
                title="Reparse this request"
              >
                {isReparsing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-forest-600" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-forest-600" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
