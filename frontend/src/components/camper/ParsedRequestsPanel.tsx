/**
 * Panel showing parsed bunk requests with expandable details
 */
import { useState } from 'react'
import { Users, ChevronDown, ChevronRight, Hash, Zap, Bug } from 'lucide-react'
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests'
import { formatSourceField } from '../../utils/formatSourceField'
import { getSourceFieldClasses } from '../../utils/sourceFieldColors'
import FirstPickBadge from './FirstPickBadge'

interface ParsedRequestsPanelProps {
  requests: EnhancedBunkRequest[]
}

export function ParsedRequestsPanel({ requests }: ParsedRequestsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set())

  const toggleRequestExpanded = (id: string) => {
    setExpandedRequests((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center justify-between px-6 py-4 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
            <Bug className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="text-left">
            <h2 className="font-display text-foreground text-lg font-bold">Parsed Bunk Requests</h2>
            <p className="text-muted-foreground text-xs">
              {requests.length} request{requests.length !== 1 ? 's' : ''} — Admin debug view
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-5 w-5" />
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5" />
        )}
      </button>

      {isExpanded && (
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
            <div className="py-8 text-center">
              <Users className="text-muted-foreground/40 mx-auto mb-3 h-10 w-10" />
              <p className="text-muted-foreground text-sm">No parsed bunk requests found</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface RequestCardProps {
  request: EnhancedBunkRequest
  isExpanded: boolean
  onToggle: () => void
}

function RequestCard({ request, isExpanded, onToggle }: RequestCardProps) {
  // Check direct source_field first, then ai_reasoning.csv_source_field
  const sourceField = request.source_field ?? request.ai_reasoning?.csv_source_field

  const borderColor =
    request.request_type === 'bunk_with'
      ? 'border-l-green-500'
      : request.request_type === 'not_bunk_with'
        ? 'border-l-red-500'
        : 'border-l-blue-500'

  const bgColor =
    request.request_type === 'bunk_with'
      ? 'bg-green-100 dark:bg-green-900/30'
      : request.request_type === 'not_bunk_with'
        ? 'bg-red-100 dark:bg-red-900/30'
        : 'bg-blue-100 dark:bg-blue-900/30'

  const textColor =
    request.request_type === 'bunk_with'
      ? 'text-green-600 dark:text-green-400'
      : request.request_type === 'not_bunk_with'
        ? 'text-red-600 dark:text-red-400'
        : 'text-blue-600 dark:text-blue-400'

  const typeLabel =
    request.request_type === 'bunk_with'
      ? 'Bunk With'
      : request.request_type === 'not_bunk_with'
        ? 'Not Bunk With'
        : 'Age Preference'

  const typeIcon =
    request.request_type === 'bunk_with'
      ? '+'
      : request.request_type === 'not_bunk_with'
        ? '−'
        : '↕'

  return (
    <div
      className={`border-border bg-muted/10 overflow-hidden rounded-xl border border-l-4 ${borderColor}`}
    >
      {/* Request Summary - Always visible */}
      <button
        onClick={onToggle}
        className="hover:bg-muted/30 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        {/* Type icon */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${bgColor}`}
        >
          <span className={`text-lg font-bold ${textColor}`}>{typeIcon}</span>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground font-medium">{typeLabel}</span>
            {request.requestedPersonName && (
              <span className="text-muted-foreground">
                → <span className="text-foreground font-medium">{request.requestedPersonName}</span>
              </span>
            )}
            {request.requestee_id && request.requestee_id < 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Unresolved
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
            <FirstPickBadge isFirstRequested={request.is_first_requested ?? false} />
            <StatusBadge status={request.status} />
            {request.confidence_score && <ConfidenceBadge score={request.confidence_score} />}
            <SourceFieldBadge sourceField={sourceField} />
            {request.is_reciprocal && (
              <span className="text-forest-600 dark:text-forest-400">Reciprocal</span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-5 w-5 flex-shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5 flex-shrink-0" />
        )}
      </button>

      {/* Expanded Details */}
      {isExpanded && <RequestDetails request={request} />}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const bgColor =
    status === 'resolved'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
      : status === 'pending'
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400'

  return <span className={`rounded px-1.5 py-0.5 ${bgColor}`}>{status}</span>
}

function ConfidenceBadge({ score }: { score: number }) {
  const textColor =
    score >= 0.95
      ? 'text-green-600 dark:text-green-400'
      : score >= 0.85
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  return <span className={textColor}>{(score * 100).toFixed(0)}% confidence</span>
}

// Badge showing which source field the request came from
function SourceFieldBadge({ sourceField }: { sourceField: string | undefined }) {
  if (!sourceField) return null

  const label = formatSourceField(sourceField)
  const colorClass = getSourceFieldClasses(sourceField)

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${colorClass} `}
    >
      {label}
    </span>
  )
}

function RequestDetails({ request }: { request: EnhancedBunkRequest }) {
  // Check direct source_field first, then ai_reasoning.csv_source_field
  const sourceField = request.source_field ?? request.ai_reasoning?.csv_source_field

  return (
    <div className="border-border bg-muted/20 border-t px-4 pt-2 pb-4">
      {/* Original text with source field badge */}
      {request.original_text && (
        <div className="mb-4 rounded-lg bg-stone-100 p-3 dark:bg-stone-800/50">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Original Text
            </p>
            <SourceFieldBadge sourceField={sourceField} />
          </div>
          <p className="text-foreground text-sm">{request.original_text}</p>
        </div>
      )}

      {/* Notes section */}
      {(request.parse_notes ?? request.socialize_explain ?? request.manual_notes) && (
        <div className="mb-4 space-y-2">
          {request.parse_notes && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">AI Notes:</span>
              <span className="text-foreground italic">{request.parse_notes}</span>
            </div>
          )}
          {request.socialize_explain && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">Socialize:</span>
              <span className="text-foreground italic">"{request.socialize_explain}"</span>
            </div>
          )}
          {request.manual_notes && (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground flex-shrink-0">Manual Notes:</span>
              <span className="text-foreground italic">{request.manual_notes}</span>
            </div>
          )}
        </div>
      )}

      {/* Keywords found */}
      <KeywordsDisplay request={request} />

      {/* AI Reasoning */}
      <ReasoningDisplay request={request} />

      {/* Technical details grid */}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
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
          value={request.requestedPersonName ?? 'N/A'}
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
            request.confidence_score ? `${(request.confidence_score * 100).toFixed(2)}%` : 'N/A'
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
          label="Created"
          value={request.created ? new Date(request.created).toLocaleString() : 'N/A'}
          color={undefined}
        />
        <DetailField
          label="Updated"
          value={request.updated ? new Date(request.updated).toLocaleString() : 'N/A'}
          color={undefined}
        />
      </div>

      {/* Flags row */}
      <div className="border-border mt-3 flex gap-3 border-t pt-3 text-xs">
        <span
          className={`rounded px-2 py-1 ${request.is_reciprocal ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
        >
          {request.is_reciprocal ? 'Reciprocal' : 'Not Reciprocal'}
        </span>
      </div>
    </div>
  )
}

// Helper to extract keywords array from various formats
function getKeywordsArray(request: EnhancedBunkRequest): string[] {
  // Direct keywords_found field (should be array)
  if (request.keywords_found) {
    if (Array.isArray(request.keywords_found)) {
      return request.keywords_found as string[]
    }
    // Handle if stored as JSON object with array
    if (typeof request.keywords_found === 'object' && 'keywords' in request.keywords_found) {
      return (request.keywords_found as { keywords: string[] }).keywords
    }
  }
  // Check metadata['keywords_found']
  const metadataKeywords = request.metadata?.['keywords_found']
  if (metadataKeywords) {
    if (Array.isArray(metadataKeywords)) {
      return metadataKeywords as string[]
    }
  }
  return []
}

// Helper to extract reasoning from various formats
function getReasoning(request: EnhancedBunkRequest): string | null {
  // Check ai_reasoning['reasoning'] (most common)
  const aiReasoning = request.ai_reasoning?.['reasoning']
  if (aiReasoning) {
    return aiReasoning as string
  }
  // Check metadata['ai_p1_reasoning'].reasoning
  const p1Reasoning = request.metadata?.['ai_p1_reasoning'] as { reasoning?: string } | undefined
  if (p1Reasoning?.reasoning) {
    return p1Reasoning.reasoning
  }
  return null
}

function KeywordsDisplay({ request }: { request: EnhancedBunkRequest }) {
  const keywords = getKeywordsArray(request)
  if (keywords.length === 0) return null

  return (
    <div className="mb-4 flex items-start gap-2">
      <Hash className="text-forest-500 mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword, i) => (
          <span
            key={i}
            className="dark:bg-bark-700/50 text-foreground border-bark-200 dark:border-bark-600 inline-flex rounded-md border bg-white/80 px-2 py-0.5 text-xs font-medium"
          >
            {keyword}
          </span>
        ))}
      </div>
    </div>
  )
}

function ReasoningDisplay({ request }: { request: EnhancedBunkRequest }) {
  const reasoning = getReasoning(request)
  if (!reasoning) return null

  return (
    <div className="mb-4 flex items-start gap-2">
      <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
      <p className="text-muted-foreground text-sm leading-relaxed italic">{reasoning}</p>
    </div>
  )
}

function DetailField({
  label,
  value,
  mono,
  color,
  warning,
  suffix,
}: {
  label: string
  value: string
  mono?: boolean
  color: string | undefined
  warning?: boolean
  suffix?: string
}) {
  return (
    <div>
      <span className="text-muted-foreground block">{label}</span>
      <span
        className={`${mono ? 'font-mono' : 'font-medium'} ${color ?? 'text-foreground'} ${warning ? 'text-amber-600 italic dark:text-amber-400' : ''}`}
      >
        {value}
        {suffix}
      </span>
    </div>
  )
}

export default ParsedRequestsPanel
