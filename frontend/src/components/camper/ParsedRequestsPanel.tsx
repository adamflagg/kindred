/**
 * Panel showing parsed bunk requests with expandable details
 */
import { useState } from 'react';
import { Users, ChevronDown, ChevronRight } from 'lucide-react';
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests';

interface ParsedRequestsPanelProps {
  requests: EnhancedBunkRequest[];
}

export function ParsedRequestsPanel({ requests }: ParsedRequestsPanelProps) {
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(
    new Set()
  );

  const toggleRequestExpanded = (id: string) => {
    setExpandedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 bg-muted/30">
        <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
          <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-display font-bold text-foreground">
            Parsed Bunk Requests
          </h2>
          {requests.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {requests.length} request{requests.length !== 1 ? 's' : ''} found
            </p>
          )}
        </div>
      </div>

      <div className="p-6">
        {requests.length > 0 ? (
          <div className="space-y-3">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                isExpanded={expandedRequests.has(request.id)}
                onToggle={() => toggleRequestExpanded(request.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Users className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              No parsed bunk requests found
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface RequestCardProps {
  request: EnhancedBunkRequest;
  isExpanded: boolean;
  onToggle: () => void;
}

function RequestCard({ request, isExpanded, onToggle }: RequestCardProps) {
  const borderColor =
    request.request_type === 'bunk_with'
      ? 'border-l-green-500'
      : request.request_type === 'not_bunk_with'
        ? 'border-l-red-500'
        : 'border-l-blue-500';

  const bgColor =
    request.request_type === 'bunk_with'
      ? 'bg-green-100 dark:bg-green-900/30'
      : request.request_type === 'not_bunk_with'
        ? 'bg-red-100 dark:bg-red-900/30'
        : 'bg-blue-100 dark:bg-blue-900/30';

  const textColor =
    request.request_type === 'bunk_with'
      ? 'text-green-600 dark:text-green-400'
      : request.request_type === 'not_bunk_with'
        ? 'text-red-600 dark:text-red-400'
        : 'text-blue-600 dark:text-blue-400';

  const typeLabel =
    request.request_type === 'bunk_with'
      ? 'Bunk With'
      : request.request_type === 'not_bunk_with'
        ? 'Not Bunk With'
        : request.request_type === 'age_preference'
          ? 'Age Preference'
          : request.request_type;

  const typeIcon =
    request.request_type === 'bunk_with'
      ? '+'
      : request.request_type === 'not_bunk_with'
        ? '−'
        : '↕';

  return (
    <div
      className={`border border-border rounded-xl overflow-hidden bg-muted/10 border-l-4 ${borderColor}`}
    >
      {/* Request Summary - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        {/* Type icon */}
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgColor}`}
        >
          <span className={`text-lg font-bold ${textColor}`}>{typeIcon}</span>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">{typeLabel}</span>
            {request.requestedPersonName && (
              <span className="text-muted-foreground">
                →{' '}
                <span className="text-foreground font-medium">
                  {request.requestedPersonName}
                </span>
              </span>
            )}
            {request.requestee_id && request.requestee_id < 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                Unresolved
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <PriorityBadge priority={request.priority ?? 0} />
            <StatusBadge status={request.status} />
            {request.confidence_score && (
              <ConfidenceBadge score={request.confidence_score} />
            )}
            {request.is_reciprocal && (
              <span className="text-forest-600 dark:text-forest-400">
                Reciprocal
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded Details */}
      {isExpanded && <RequestDetails request={request} />}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const bgColor =
    priority >= 8
      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
      : priority >= 5
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400';

  return <span className={`px-1.5 py-0.5 rounded ${bgColor}`}>P{priority}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const bgColor =
    status === 'resolved'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
      : status === 'pending'
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400';

  return <span className={`px-1.5 py-0.5 rounded ${bgColor}`}>{status}</span>;
}

function ConfidenceBadge({ score }: { score: number }) {
  const textColor =
    score >= 0.95
      ? 'text-green-600 dark:text-green-400'
      : score >= 0.85
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <span className={textColor}>{(score * 100).toFixed(0)}% confidence</span>
  );
}

function RequestDetails({ request }: { request: EnhancedBunkRequest }) {
  return (
    <div className="px-4 pb-4 pt-2 border-t border-border bg-muted/20">
      {/* Original text */}
      {request.original_text && (
        <div className="mb-4 p-3 rounded-lg bg-stone-100 dark:bg-stone-800/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Original Text
          </p>
          <p className="text-sm text-foreground">{request.original_text}</p>
        </div>
      )}

      {/* Notes section */}
      {(request.parse_notes ||
        request.socialize_explain ||
        request.manual_notes) && (
        <div className="mb-4 space-y-2">
          {request.parse_notes && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">
                AI Notes:
              </span>
              <span className="italic text-foreground">
                {request.parse_notes}
              </span>
            </div>
          )}
          {request.socialize_explain && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">
                Socialize:
              </span>
              <span className="italic text-foreground">
                "{request.socialize_explain}"
              </span>
            </div>
          )}
          {request.manual_notes && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">
                Manual Notes:
              </span>
              <span className="italic text-foreground">
                {request.manual_notes}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Technical details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <DetailField label="Record ID" value={request.id || 'N/A'} mono color={undefined} />
        <DetailField
          label="Requester ID"
          value={String(request.requester_id || 'N/A')}
          color={undefined}
        />
        <DetailField
          label="Requestee ID"
          value={
            request.requestee_id && request.requestee_id > 0
              ? String(request.requestee_id)
              : request.requestee_id
                ? `Unresolved (${request.requestee_id})`
                : 'None'
          }
          color={undefined}
        />
        <DetailField
          label="Requested Name"
          value={request.requestedPersonName || 'N/A'}
          color={undefined}
          warning={request.requestee_id != null && request.requestee_id < 0}
          suffix={
            request.requestee_id != null && request.requestee_id < 0 ? ' (needs resolution)' : ''
          }
        />
        <DetailField
          label="Session ID"
          value={String(request.session_id || 'N/A')}
          color={undefined}
        />
        <DetailField label="Year" value={String(request.year || 'N/A')} color={undefined} />
        <DetailField
          label="Confidence"
          value={
            request.confidence_score
              ? `${(request.confidence_score * 100).toFixed(2)}%`
              : 'N/A'
          }
          color={
            (request.confidence_score ?? 0) >= 0.95
              ? 'text-green-600 dark:text-green-400'
              : (request.confidence_score ?? 0) >= 0.85
                ? 'text-amber-600 dark:text-amber-400'
                : (request.confidence_score ?? 0) > 0
                  ? 'text-red-600 dark:text-red-400'
                  : undefined
          }
        />
        <DetailField
          label="Source"
          value={request.source?.replace(/_/g, ' ') || 'N/A'}
          color={undefined}
        />
        <DetailField
          label="Created"
          value={
            request.created
              ? new Date(request.created).toLocaleString()
              : 'N/A'
          }
          color={undefined}
        />
        <DetailField
          label="Updated"
          value={
            request.updated
              ? new Date(request.updated).toLocaleString()
              : 'N/A'
          }
          color={undefined}
        />
      </div>

      {/* Flags row */}
      <div className="flex gap-3 mt-3 pt-3 border-t border-border text-xs">
        <span
          className={`px-2 py-1 rounded ${request.is_reciprocal ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
        >
          {request.is_reciprocal ? 'Reciprocal' : 'Not Reciprocal'}
        </span>
        <span
          className={`px-2 py-1 rounded ${request.priority_locked ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}
        >
          {request.priority_locked ? 'Priority Locked' : 'Priority Unlocked'}
        </span>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
  color,
  warning,
  suffix,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color: string | undefined;
  warning?: boolean;
  suffix?: string;
}) {
  return (
    <div>
      <span className="text-muted-foreground block">{label}</span>
      <span
        className={`${mono ? 'font-mono' : 'font-medium'} ${color || 'text-foreground'} ${warning ? 'text-amber-600 dark:text-amber-400 italic' : ''}`}
      >
        {value}
        {suffix}
      </span>
    </div>
  );
}

export default ParsedRequestsPanel;
