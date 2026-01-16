/**
 * ParseAnalysisList - Left panel with requester list and selection
 *
 * Shows a scrollable list of requesters with their parse status.
 * Each row has a per-row reprocess button.
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
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading requests...</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 border-2 border-dashed border-border/50 rounded-xl">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <User className="w-10 h-10 opacity-30" />
          <span className="text-sm font-medium">No results found</span>
          <span className="text-xs">Try adjusting your filters</span>
        </div>
      </div>
    );
  }

  return (
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
              transition-all duration-150 border-2
              ${
                isSelected
                  ? 'bg-primary/5 border-primary/30 shadow-sm'
                  : 'bg-card border-transparent hover:bg-muted/50 hover:border-border/50'
              }
            `}
            onClick={() => onSelect(item)}
          >
            {/* Selection indicator */}
            <div
              className={`
                w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                transition-colors
                ${isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'}
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
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`
                    inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium
                    ${item.source_field === 'bunk_with' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : ''}
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
                p-1.5 rounded-lg transition-all flex-shrink-0
                ${
                  isReparsing
                    ? 'bg-violet-100 dark:bg-violet-900/30'
                    : 'opacity-0 group-hover:opacity-100 bg-muted/50 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                }
              `}
              title="Reparse this request"
            >
              {isReparsing ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
              ) : (
                <RefreshCw className="w-4 h-4 text-violet-600" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
