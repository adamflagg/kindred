/**
 * ParseAnalysisDetail - Right panel showing multiple fields for a selected camper
 *
 * Each field displays as a row: field type header + source toggle + (original text | parsed intents)
 * Features a debug/prod toggle to switch between viewing debug and production results.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  FileText,
  FlaskConical,
  Loader2,
  RefreshCw,
  Sparkles,
  User,
} from 'lucide-react';
import { ParseIntentCard } from './ParseIntentCard';
import { SOURCE_FIELD_LABELS } from './types';
import type {
  FieldParseResult,
  DualSourceParseResult,
  SourceFieldType,
  SourceViewMode,
  ParseResultData,
} from './types';

interface ParseAnalysisDetailProps {
  camperName: string | null;
  camperCmId: number | null;
  fields: FieldParseResult[];
  parseResults: Array<DualSourceParseResult | null>;
  isLoading?: boolean;
  onReparse?: () => void;
  isReparsing?: boolean;
}

// Toggle button for switching between debug and production views
function SourceToggle({
  hasDebug,
  hasProduction,
  viewMode,
  onChange,
}: {
  hasDebug: boolean;
  hasProduction: boolean;
  viewMode: SourceViewMode;
  onChange: (mode: SourceViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-bark-100 dark:bg-bark-800 p-0.5">
      <button
        type="button"
        onClick={() => onChange('debug')}
        disabled={!hasDebug}
        className={`
          inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all
          ${
            viewMode === 'debug'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-400 shadow-sm'
              : hasDebug
                ? 'text-bark-500 dark:text-bark-400 hover:text-amber-600 dark:hover:text-amber-400'
                : 'text-bark-300 dark:text-bark-600 cursor-not-allowed opacity-50'
          }
        `}
      >
        <FlaskConical className="w-3 h-3" />
        Debug
      </button>
      <button
        type="button"
        onClick={() => onChange('production')}
        disabled={!hasProduction}
        className={`
          inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all
          ${
            viewMode === 'production'
              ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/60 dark:text-forest-400 shadow-sm'
              : hasProduction
                ? 'text-bark-500 dark:text-bark-400 hover:text-forest-600 dark:hover:text-forest-400'
                : 'text-bark-300 dark:text-bark-600 cursor-not-allowed opacity-50'
          }
        `}
      >
        <Database className="w-3 h-3" />
        Prod
      </button>
    </div>
  );
}

// Component for a single field row (original text + parsed intents)
function FieldRow({
  field,
  dualResult,
  viewMode,
  onViewModeChange,
}: {
  field: FieldParseResult;
  dualResult: DualSourceParseResult | null;
  viewMode: SourceViewMode;
  onViewModeChange: (mode: SourceViewMode) => void;
}) {
  const fieldLabel =
    SOURCE_FIELD_LABELS[field.source_field as SourceFieldType] || field.source_field;

  // Field type color classes
  const fieldColorClass = (() => {
    switch (field.source_field) {
      case 'bunk_with':
        return 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400 border-forest-200 dark:border-forest-800';
      case 'not_bunk_with':
        return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 border-rose-200 dark:border-rose-800';
      case 'bunking_notes':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      case 'internal_notes':
        return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400 border-violet-200 dark:border-violet-800';
      default:
        return 'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400 border-bark-200 dark:border-bark-700';
    }
  })();

  // Get current result based on view mode
  const currentResult: ParseResultData | null = useMemo(() => {
    if (!dualResult) return null;
    return viewMode === 'debug' ? dualResult.debug_result : dualResult.production_result;
  }, [dualResult, viewMode]);

  const hasDebug = dualResult?.has_debug ?? false;
  const hasProduction = dualResult?.has_production ?? false;

  // Validity indicator
  const renderValidityBadge = () => {
    if (!currentResult) return null;
    if (currentResult.is_valid) {
      return (
        <span className="inline-flex items-center gap-1 text-forest-600 dark:text-forest-400">
          <CheckCircle className="w-3.5 h-3.5" />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
        <AlertTriangle className="w-3.5 h-3.5" />
      </span>
    );
  };

  const intents = currentResult?.parsed_intents ?? [];
  const originalText = dualResult?.original_text ?? field.original_text;

  return (
    <div className={`card-lodge border-l-4 ${fieldColorClass} overflow-hidden`}>
      {/* Field header */}
      <div className="flex items-center justify-between gap-3 p-3 bg-parchment-50/50 dark:bg-bark-900/30 border-b border-bark-100 dark:border-bark-700">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">{fieldLabel}</span>
          {renderValidityBadge()}
        </div>
        <SourceToggle
          hasDebug={hasDebug}
          hasProduction={hasProduction}
          viewMode={viewMode}
          onChange={onViewModeChange}
        />
      </div>

      {/* Error message if invalid */}
      {currentResult && !currentResult.is_valid && currentResult.error_message && (
        <div className="px-3 py-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-rose-700 dark:text-rose-400">{currentResult.error_message}</p>
          </div>
        </div>
      )}

      {/* Content: Original text | Parsed intents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {/* Original Text */}
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Original text
          </h5>
          <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground bg-white/50 dark:bg-bark-800/50 rounded-lg p-3">
            {originalText || <em className="text-muted-foreground">No text</em>}
          </div>
        </div>

        {/* Parsed Intents */}
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Parsed intents ({intents.length})
          </h5>
          <div className="space-y-2">
            {intents.length === 0 ? (
              <div className="text-sm text-muted-foreground italic p-3 bg-white/50 dark:bg-bark-800/50 rounded-lg">
                No intents parsed
              </div>
            ) : (
              intents.map((intent, idx) => (
                <ParseIntentCard key={idx} intent={intent} index={idx} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ParseAnalysisDetail({
  camperName,
  camperCmId,
  fields,
  parseResults,
  isLoading,
  onReparse,
  isReparsing,
}: ParseAnalysisDetailProps) {
  // Track view mode for each field by original_request_id
  const [viewModes, setViewModes] = useState<Record<string, SourceViewMode>>({});

  // Calculate default view modes based on availability: debug if available, else production
  const defaultViewModes = useMemo(() => {
    const modes: Record<string, SourceViewMode> = {};
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;
      const result = parseResults[i];
      // Default: debug if available, else production
      modes[field.original_request_id] = result?.has_debug ? 'debug' : 'production';
    }
    return modes;
  }, [fields, parseResults]);

  // Stable key for tracking when fields change (camper changes)
  const fieldsKey = useMemo(
    () => fields.map((f) => f.original_request_id).join(','),
    [fields]
  );

  // Reset view modes when camper changes (fields change)
  // This pattern is intentional - we need to clear overrides when the camper changes
  useEffect(() => {
    setViewModes({}); // eslint-disable-line
  }, [fieldsKey]);

  // Get effective view mode for a field (uses override if set, else default)
  const getViewMode = (fieldId: string): SourceViewMode => {
    return viewModes[fieldId] ?? defaultViewModes[fieldId] ?? 'debug';
  };

  // Update view mode for a specific field
  const handleViewModeChange = (fieldId: string, mode: SourceViewMode) => {
    setViewModes((prev) => ({ ...prev, [fieldId]: mode }));
  };

  if (isLoading && fields.length > 0) {
    return (
      <div className="card-lodge flex items-center justify-center h-96 bg-parchment-100/30 dark:bg-bark-900/20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-forest-600" />
          <span className="text-sm text-muted-foreground">Loading analysis...</span>
        </div>
      </div>
    );
  }

  if (!camperName || fields.length === 0) {
    return (
      <div className="space-y-4">
        {/* Placeholder header to match left panel alignment */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-display font-bold text-foreground">Details</h3>
            <span className="px-2 py-0.5 rounded-md bg-bark-100 dark:bg-bark-800 font-mono text-xs text-muted-foreground">
              Select a camper
            </span>
          </div>
        </div>

        {/* Empty state content */}
        <div className="card-lodge flex items-center justify-center h-96 bg-parchment-100/30 dark:bg-bark-900/20">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-bark-100 dark:bg-bark-800 flex items-center justify-center">
              <User className="w-8 h-8 text-bark-400" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              Select a camper to view their fields
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with camper name and reparse button */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-display font-bold text-foreground">
            {camperCmId ? (
              <a
                href={`/summer/camper/${camperCmId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-forest-600 dark:hover:text-forest-400 transition-colors"
              >
                {camperName}
              </a>
            ) : (
              camperName
            )}
          </h3>
          {camperCmId && (
            <span className="px-2 py-0.5 rounded-md bg-bark-100 dark:bg-bark-800 font-mono text-xs text-muted-foreground">
              CM ID: {camperCmId}
            </span>
          )}
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

      {/* Field rows */}
      <div className="space-y-4">
        {fields.map((field, idx) => (
          <FieldRow
            key={field.original_request_id}
            field={field}
            dualResult={parseResults[idx] ?? null}
            viewMode={getViewMode(field.original_request_id)}
            onViewModeChange={(mode) => handleViewModeChange(field.original_request_id, mode)}
          />
        ))}
      </div>
    </div>
  );
}
