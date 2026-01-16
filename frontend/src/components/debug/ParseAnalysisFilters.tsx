/**
 * ParseAnalysisFilters - Filter controls for parse analysis
 *
 * Session and source field dropdowns with bulk reparse action.
 */

import { ChevronDown, Filter, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { SOURCE_FIELD_LABELS } from './types';
import type { SourceFieldType } from './types';

interface Session {
  id: string;
  cm_id: number;
  name: string;
}

interface ParseAnalysisFiltersProps {
  sessions: Session[];
  selectedSessionCmId: number | null;
  onSessionChange: (cmId: number | null) => void;
  selectedSourceField: SourceFieldType | null;
  onSourceFieldChange: (field: SourceFieldType | null) => void;
  onReparseSelected: () => void;
  onClearAll: () => void;
  isReparsing: boolean;
  isClearing: boolean;
  selectedCount: number;
}

export function ParseAnalysisFilters({
  sessions,
  selectedSessionCmId,
  onSessionChange,
  selectedSourceField,
  onSourceFieldChange,
  onReparseSelected,
  onClearAll,
  isReparsing,
  isClearing,
  selectedCount,
}: ParseAnalysisFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
      {/* Filter icon */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Filter className="w-4 h-4" />
        <span className="text-sm font-medium">Filters</span>
      </div>

      {/* Session dropdown */}
      <div className="relative">
        <select
          value={selectedSessionCmId ?? ''}
          onChange={(e) => onSessionChange(e.target.value ? Number(e.target.value) : null)}
          className="
            appearance-none pl-3 pr-8 py-2 rounded-lg text-sm font-medium
            bg-card border border-border hover:border-primary/50
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            cursor-pointer transition-colors
          "
        >
          <option value="">All Sessions</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.cm_id}>
              {session.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </div>

      {/* Source field dropdown */}
      <div className="relative">
        <select
          value={selectedSourceField ?? ''}
          onChange={(e) => onSourceFieldChange((e.target.value as SourceFieldType) || null)}
          className="
            appearance-none pl-3 pr-8 py-2 rounded-lg text-sm font-medium
            bg-card border border-border hover:border-primary/50
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            cursor-pointer transition-colors
          "
        >
          <option value="">All Fields</option>
          {(Object.entries(SOURCE_FIELD_LABELS) as Array<[SourceFieldType, string]>).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            )
          )}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Reparse selected button */}
        <button
          onClick={onReparseSelected}
          disabled={isReparsing || selectedCount === 0}
          className="
            inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-gradient-to-br from-violet-500 to-purple-600 text-white
            hover:from-violet-600 hover:to-purple-700
            disabled:opacity-50 disabled:cursor-not-allowed
            shadow-md hover:shadow-lg transition-all
          "
        >
          {isReparsing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Reparsing...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Reparse All ({selectedCount})
            </>
          )}
        </button>

        {/* Clear all button */}
        <button
          onClick={onClearAll}
          disabled={isClearing}
          className="
            inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-muted/50 text-muted-foreground hover:bg-rose-100 hover:text-rose-700
            dark:hover:bg-rose-900/30 dark:hover:text-rose-400
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all
          "
          title="Clear all parse analysis results"
        >
          {isClearing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Clearing...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" />
              Clear All
            </>
          )}
        </button>
      </div>
    </div>
  );
}
