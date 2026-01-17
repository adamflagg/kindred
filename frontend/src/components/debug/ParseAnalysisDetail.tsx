/**
 * ParseAnalysisDetail - Right panel showing original text vs parsed intents
 *
 * Split-view comparison of the raw input text and the AI-parsed intents.
 * Shows source badge (Debug/Production/Not parsed) to indicate data origin.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { AlertTriangle, CheckCircle, Clock, Database, FileText, FlaskConical, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { ParseIntentCard } from './ParseIntentCard';
import { SOURCE_FIELD_LABELS } from './types';
import type { ParseResultWithSource, SourceFieldType } from './types';

interface ParseAnalysisDetailProps {
  item: ParseResultWithSource | null;
  isLoading?: boolean | undefined;
  onReparse?: (() => void) | undefined;
  isReparsing?: boolean | undefined;
}

export function ParseAnalysisDetail({
  item,
  isLoading,
  onReparse,
  isReparsing,
}: ParseAnalysisDetailProps) {
  if (isLoading) {
    return (
      <div className="card-lodge flex items-center justify-center h-96 bg-parchment-100/30 dark:bg-bark-900/20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-forest-600" />
          <span className="text-sm text-muted-foreground">Loading analysis...</span>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="card-lodge flex items-center justify-center h-96 bg-parchment-100/30 dark:bg-bark-900/20">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl bg-bark-100 dark:bg-bark-800 flex items-center justify-center">
            <FileText className="w-8 h-8 text-bark-400" />
          </div>
          <span className="text-sm font-semibold text-foreground">Select a requester to view analysis</span>
        </div>
      </div>
    );
  }

  const sourceLabel =
    SOURCE_FIELD_LABELS[item.source_field as SourceFieldType] || item.source_field || 'Unknown';

  return (
    <div className="space-y-6">
      {/* Header with requester info and actions */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-display font-bold text-foreground">{item.requester_name || 'Unknown'}</h3>
            {/* Source badge */}
            {item.source === 'debug' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                <FlaskConical className="w-3.5 h-3.5" />
                Debug Result
              </span>
            ) : item.source === 'production' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400">
                <Database className="w-3.5 h-3.5" />
                Production Result
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400">
                Not Parsed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
            {item.requester_cm_id && (
              <span className="px-2 py-0.5 rounded-md bg-bark-100 dark:bg-bark-800 font-mono text-xs">
                CM ID: {item.requester_cm_id}
              </span>
            )}
            <span
              className={`
                inline-flex px-2.5 py-0.5 rounded-md text-xs font-semibold
                ${item.source_field === 'bunk_with' ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/30 dark:text-forest-400' : ''}
                ${item.source_field === 'not_bunk_with' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : ''}
                ${item.source_field === 'bunking_notes' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : ''}
                ${item.source_field === 'internal_notes' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' : ''}
              `}
            >
              {sourceLabel}
            </span>
          </div>
        </div>

        {onReparse && (
          <button
            onClick={onReparse}
            disabled={isReparsing}
            className="btn-primary !rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isReparsing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Reparsing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Reparse
              </>
            )}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="card-lodge flex flex-wrap gap-4 p-4 bg-parchment-100/50 dark:bg-bark-900/30">
        <div className="flex items-center gap-2">
          {item.is_valid ? (
            <CheckCircle className="w-4 h-4 text-forest-500" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          )}
          <span className={`text-sm font-semibold ${item.is_valid ? 'text-forest-600 dark:text-forest-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {item.is_valid ? 'Valid' : 'Invalid'}
          </span>
        </div>

        {item.token_count !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>{item.token_count.toLocaleString()} tokens</span>
          </div>
        )}

        {item.processing_time_ms !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4 text-forest-500" />
            <span>{item.processing_time_ms}ms</span>
          </div>
        )}

        {item.prompt_version && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-bark-100 dark:bg-bark-800 text-bark-600 dark:text-bark-300">
              {item.prompt_version}
            </span>
          </div>
        )}
      </div>

      {/* Error message if invalid */}
      {!item.is_valid && item.error_message && (
        <div className="card-lodge p-4 bg-rose-50 dark:bg-rose-950/30 !border-rose-200 dark:!border-rose-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-800 dark:text-rose-300">Parse Error</p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">{item.error_message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Split view: Original text vs Parsed intents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Original Text */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-forest-700 dark:text-forest-400 uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Original Text
          </h4>
          <div className="card-lodge p-4 bg-parchment-200/50 dark:bg-bark-800/50">
            <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {item.original_text || <em className="text-muted-foreground">No text</em>}
            </div>
          </div>
        </div>

        {/* Parsed Intents */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-forest-700 dark:text-forest-400 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Parsed Intents ({item.parsed_intents.length})
          </h4>
          <div className="space-y-3">
            {item.parsed_intents.length === 0 ? (
              <div className="card-lodge p-4 text-center bg-parchment-100/50 dark:bg-bark-900/30">
                <span className="text-sm text-muted-foreground">No intents parsed</span>
              </div>
            ) : (
              item.parsed_intents.map((intent, idx) => (
                <ParseIntentCard key={idx} intent={intent} index={idx} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
