/**
 * ParseIntentCard - Displays a single parsed intent from Phase 1
 *
 * Features distinct styling per request type and shows all parsed data
 * including keywords, reasoning, and temporal info when present.
 */

import { AlertCircle, Clock, Hash, MessageSquare, Target, Zap } from 'lucide-react';
import { REQUEST_TYPE_COLORS } from './types';
import type { ParsedIntent } from './types';

interface ParseIntentCardProps {
  intent: ParsedIntent;
  index: number;
}

const DEFAULT_COLORS = {
  bg: 'bg-slate-50 dark:bg-slate-950/30',
  text: 'text-slate-700 dark:text-slate-400',
  border: 'border-slate-200 dark:border-slate-800',
};

export function ParseIntentCard({ intent, index }: ParseIntentCardProps) {
  const colors = REQUEST_TYPE_COLORS[intent.request_type] ?? DEFAULT_COLORS;

  const formatRequestType = (type: string) => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div
      className={`
        relative rounded-xl border-2 overflow-hidden transition-all duration-200
        hover:shadow-lg hover:-translate-y-0.5
        ${colors.bg} ${colors.border}
      `}
    >
      {/* Intent number badge */}
      <div
        className={`
          absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center
          font-mono text-xs font-bold ${colors.text} bg-white/60 dark:bg-black/30
        `}
      >
        #{index + 1}
      </div>

      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className={`inline-flex items-center gap-2 text-sm font-bold ${colors.text}`}>
          <Target className="w-4 h-4" />
          {formatRequestType(intent.request_type)}
        </div>

        {/* Target name - prominent display */}
        {intent.target_name && (
          <div className="mt-2 text-lg font-semibold text-foreground">
            {intent.target_name}
          </div>
        )}
      </div>

      {/* Details section */}
      <div className="px-4 pb-4 space-y-3">
        {/* Keywords */}
        {intent.keywords_found.length > 0 && (
          <div className="flex items-start gap-2">
            <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {intent.keywords_found.map((keyword, i) => (
                <span
                  key={i}
                  className="inline-flex px-2 py-0.5 text-xs font-medium rounded-md bg-white/70 dark:bg-black/20 text-foreground"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Parse notes */}
        {intent.parse_notes && (
          <div className="flex items-start gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">{intent.parse_notes}</p>
          </div>
        )}

        {/* Reasoning (expandable or shown if short) */}
        {intent.reasoning && (
          <div className="flex items-start gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed italic">
              {intent.reasoning}
            </p>
          </div>
        )}

        {/* Temporal info */}
        {intent.temporal_info && (
          <div
            className={`
              flex items-start gap-2 p-2.5 rounded-lg
              ${intent.temporal_info.is_superseded ? 'bg-amber-100/50 dark:bg-amber-900/20' : 'bg-blue-100/50 dark:bg-blue-900/20'}
            `}
          >
            <Clock
              className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${intent.temporal_info.is_superseded ? 'text-amber-600' : 'text-blue-600'}`}
            />
            <div className="text-sm">
              {intent.temporal_info.date && (
                <span className="font-medium">Date: {intent.temporal_info.date}</span>
              )}
              {intent.temporal_info.is_superseded && (
                <span className="ml-2 text-amber-700 dark:text-amber-400">
                  (Superseded: {intent.temporal_info.supersedes_reason})
                </span>
              )}
            </div>
          </div>
        )}

        {/* Needs clarification flag */}
        {intent.needs_clarification && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-100/50 dark:bg-rose-900/20">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
            <span className="text-sm font-medium text-rose-700 dark:text-rose-400">
              Needs clarification
            </span>
          </div>
        )}
      </div>

      {/* List position indicator */}
      <div
        className={`
          px-4 py-2 border-t text-xs font-medium flex items-center gap-1.5
          ${colors.border} ${colors.text} bg-white/30 dark:bg-black/10
        `}
      >
        Position in text: {intent.list_position}
      </div>
    </div>
  );
}
