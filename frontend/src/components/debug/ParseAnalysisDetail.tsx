/**
 * ParseAnalysisDetail - Right panel showing original text vs parsed intents
 *
 * Split-view comparison of the raw input text and the AI-parsed intents.
 */

import { AlertTriangle, CheckCircle, Clock, FileText, Loader2, Sparkles, Zap } from 'lucide-react';
import { ParseIntentCard } from './ParseIntentCard';
import { SOURCE_FIELD_LABELS } from './types';
import type { ParseAnalysisItem, SourceFieldType } from './types';

interface ParseAnalysisDetailProps {
  item: ParseAnalysisItem | null;
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
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading analysis...</span>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center h-96 border-2 border-dashed border-border/50 rounded-2xl">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <FileText className="w-12 h-12 opacity-30" />
          <span className="text-sm font-medium">Select a requester to view analysis</span>
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
          <h3 className="text-xl font-bold text-foreground">{item.requester_name || 'Unknown'}</h3>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            {item.requester_cm_id && <span>CM ID: {item.requester_cm_id}</span>}
            <span
              className={`
                inline-flex px-2 py-0.5 rounded-md text-xs font-medium
                ${item.source_field === 'bunk_with' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : ''}
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm
              bg-gradient-to-br from-violet-500 to-purple-600 text-white
              hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all"
          >
            {isReparsing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Reparsing...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Reparse
              </>
            )}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 p-4 rounded-xl bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2">
          {item.is_valid ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          )}
          <span className={`text-sm font-medium ${item.is_valid ? 'text-emerald-600' : 'text-rose-600'}`}>
            {item.is_valid ? 'Valid' : 'Invalid'}
          </span>
        </div>

        {item.token_count !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            <span>{item.token_count.toLocaleString()} tokens</span>
          </div>
        )}

        {item.processing_time_ms !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{item.processing_time_ms}ms</span>
          </div>
        )}

        {item.prompt_version && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
              {item.prompt_version}
            </span>
          </div>
        )}
      </div>

      {/* Error message if invalid */}
      {!item.is_valid && item.error_message && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-rose-800 dark:text-rose-300">Parse Error</p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">{item.error_message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Split view: Original text vs Parsed intents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Original Text */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Original Text
          </h4>
          <div
            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800
              font-mono text-sm leading-relaxed whitespace-pre-wrap"
          >
            {item.original_text || <em className="text-muted-foreground">No text</em>}
          </div>
        </div>

        {/* Parsed Intents */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Parsed Intents ({item.parsed_intents.length})
          </h4>
          <div className="space-y-3">
            {item.parsed_intents.length === 0 ? (
              <div className="p-4 rounded-xl border-2 border-dashed border-border/50 text-center">
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
