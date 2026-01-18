/**
 * CamperFieldBlock - Floating block showing field data with expandable parsed intents
 *
 * Displays original text, status badge, and action buttons for a single field.
 * Parsed intents are collapsible within the block.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { ParseIntentCard } from './ParseIntentCard';
import { SOURCE_FIELD_LABELS } from './types';
import type { FieldParseResult, ParseResultWithSource, SourceFieldType } from './types';

interface CamperFieldBlockProps {
  field: FieldParseResult;
  parseResult: ParseResultWithSource | null;
  isLoadingDetail: boolean;
  isReparsing: boolean;
  isClearing: boolean;
  onReparse: () => void;
  onClear: () => void;
  onExpand: () => void;
  isExpanded: boolean;
}

export function CamperFieldBlock({
  field,
  parseResult,
  isLoadingDetail,
  isReparsing,
  isClearing,
  onReparse,
  onClear,
  onExpand,
  isExpanded,
}: CamperFieldBlockProps) {
  const [showIntents, setShowIntents] = useState(false);

  const sourceLabel =
    SOURCE_FIELD_LABELS[field.source_field as SourceFieldType] || field.source_field || 'Unknown';

  // Determine the field color scheme
  const fieldColorClass = (() => {
    switch (field.source_field) {
      case 'bunk_with':
        return 'border-l-forest-500 dark:border-l-forest-400';
      case 'not_bunk_with':
        return 'border-l-rose-500 dark:border-l-rose-400';
      case 'bunking_notes':
        return 'border-l-amber-500 dark:border-l-amber-400';
      case 'internal_notes':
        return 'border-l-violet-500 dark:border-l-violet-400';
      default:
        return 'border-l-bark-400 dark:border-l-bark-500';
    }
  })();

  const fieldBgClass = (() => {
    switch (field.source_field) {
      case 'bunk_with':
        return 'bg-forest-50/50 dark:bg-forest-950/20';
      case 'not_bunk_with':
        return 'bg-rose-50/50 dark:bg-rose-950/20';
      case 'bunking_notes':
        return 'bg-amber-50/50 dark:bg-amber-950/20';
      case 'internal_notes':
        return 'bg-violet-50/50 dark:bg-violet-950/20';
      default:
        return 'bg-bark-50/50 dark:bg-bark-900/20';
    }
  })();

  const hasAnyResult = field.has_debug_result || field.has_production_result;
  const intentsCount = parseResult?.parsed_intents?.length ?? 0;

  return (
    <div
      className={`
        card-lodge border-l-4 ${fieldColorClass} ${fieldBgClass}
        transition-all duration-200
      `}
    >
      {/* Header row with field type, status badge, and actions */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span
            className={`
              inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold
              ${field.source_field === 'bunk_with' ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400' : ''}
              ${field.source_field === 'not_bunk_with' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' : ''}
              ${field.source_field === 'bunking_notes' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : ''}
              ${field.source_field === 'internal_notes' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' : ''}
            `}
          >
            {sourceLabel}
          </span>

          {/* Status badge */}
          {field.has_debug_result ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              title="Debug result available"
            >
              <FlaskConical className="w-3 h-3" />
              Debug
            </span>
          ) : field.has_production_result ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400"
              title="Production result available"
            >
              <Database className="w-3 h-3" />
              Production
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Not parsed</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Clear button - only shows when has debug result */}
          {field.has_debug_result && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              disabled={isClearing}
              className="p-2 rounded-lg text-bark-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all duration-200 disabled:opacity-50"
              title="Clear debug result"
            >
              {isClearing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Reparse button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReparse();
            }}
            disabled={isReparsing}
            className="p-2 rounded-lg text-bark-500 hover:text-forest-600 hover:bg-forest-50 dark:hover:bg-forest-900/20 transition-all duration-200 disabled:opacity-50"
            title="Reparse this field"
          >
            {isReparsing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Original text */}
      <div className="px-4 pb-3">
        <div className="font-mono text-sm leading-relaxed text-foreground bg-white/50 dark:bg-bark-800/50 rounded-lg p-3">
          {field.original_text || <em className="text-muted-foreground">No text</em>}
        </div>
      </div>

      {/* Expandable parsed intents section */}
      {hasAnyResult && (
        <div className="border-t border-bark-200/50 dark:border-bark-700/50">
          <button
            onClick={() => {
              if (!isExpanded) {
                onExpand();
              }
              setShowIntents(!showIntents);
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-left text-sm font-medium text-bark-600 dark:text-bark-300 hover:bg-white/30 dark:hover:bg-bark-700/30 transition-colors"
          >
            {showIntents ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Parsed Intents ({isLoadingDetail ? '...' : intentsCount})
          </button>

          {showIntents && (
            <div className="px-4 pb-4 space-y-2">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-forest-600" />
                </div>
              ) : intentsCount === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-2">
                  No intents parsed
                </div>
              ) : (
                parseResult?.parsed_intents.map((intent, idx) => (
                  <ParseIntentCard key={idx} intent={intent} index={idx} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
