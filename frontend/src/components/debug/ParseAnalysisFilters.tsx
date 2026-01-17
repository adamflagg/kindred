/**
 * ParseAnalysisFilters - Filter controls for parse analysis
 *
 * Session and source field dropdowns, search input, and bulk reparse action.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { ChevronDown, Filter, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react';
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
  searchQuery: string;
  onSearchChange: (query: string) => void;
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
  searchQuery,
  onSearchChange,
  onReparseSelected,
  onClearAll,
  isReparsing,
  isClearing,
  selectedCount,
}: ParseAnalysisFiltersProps) {
  return (
    <div className="card-lodge flex flex-wrap items-center gap-4 p-4 bg-parchment-100/50 dark:bg-bark-900/30">
      {/* Filter icon */}
      <div className="flex items-center gap-2 text-forest-600 dark:text-forest-400">
        <Filter className="w-4 h-4" />
        <span className="text-sm font-semibold">Filters</span>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bark-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search requester..."
          className="
            w-48 pl-9 pr-8 py-2.5 rounded-xl text-sm font-medium
            bg-white dark:bg-bark-800 border-2 border-bark-200 dark:border-bark-700
            hover:border-forest-400 dark:hover:border-forest-600
            focus:outline-none focus:ring-2 focus:ring-forest-500/20 focus:border-forest-500
            placeholder:text-bark-400 dark:placeholder:text-bark-500
            transition-all duration-200
          "
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-bark-100 dark:hover:bg-bark-700 text-bark-400 hover:text-bark-600 dark:hover:text-bark-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Session dropdown */}
      <div className="relative">
        <select
          value={selectedSessionCmId ?? ''}
          onChange={(e) => onSessionChange(e.target.value ? Number(e.target.value) : null)}
          className="
            appearance-none pl-4 pr-9 py-2.5 rounded-xl text-sm font-medium
            bg-white dark:bg-bark-800 border-2 border-bark-200 dark:border-bark-700
            hover:border-forest-400 dark:hover:border-forest-600
            focus:outline-none focus:ring-2 focus:ring-forest-500/20 focus:border-forest-500
            cursor-pointer transition-all duration-200
          "
        >
          <option value="">All Sessions</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.cm_id}>
              {session.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bark-400 pointer-events-none" />
      </div>

      {/* Source field dropdown */}
      <div className="relative">
        <select
          value={selectedSourceField ?? ''}
          onChange={(e) => onSourceFieldChange((e.target.value as SourceFieldType) || null)}
          className="
            appearance-none pl-4 pr-9 py-2.5 rounded-xl text-sm font-medium
            bg-white dark:bg-bark-800 border-2 border-bark-200 dark:border-bark-700
            hover:border-forest-400 dark:hover:border-forest-600
            focus:outline-none focus:ring-2 focus:ring-forest-500/20 focus:border-forest-500
            cursor-pointer transition-all duration-200
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
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bark-400 pointer-events-none" />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-3">
        {/* Reparse selected button */}
        <button
          onClick={onReparseSelected}
          disabled={isReparsing || selectedCount === 0}
          className="btn-primary !rounded-xl !px-5 !py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
            inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
            bg-bark-100 dark:bg-bark-800 text-bark-600 dark:text-bark-300
            border-2 border-bark-200 dark:border-bark-700
            hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200
            dark:hover:bg-rose-900/20 dark:hover:text-rose-400 dark:hover:border-rose-800
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
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
