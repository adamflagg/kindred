import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Users,
  Home,
  Heart,
  Zap,
  Sparkles,
} from 'lucide-react'
import { Modal } from './ui/Modal'
import type {
  ImpossibilityReport,
  ImpossibilityReportItem,
  EntirelyImpossibleMpCamper,
} from '../services/solver'

interface CapacityBreakdownItem {
  campers: number
  beds: number
  sufficient: boolean
}

interface ValidationStatistics {
  total_campers: number
  total_bunks: number
  total_capacity: number
  total_requests: number
  campers_with_requests: number
  campers_without_requests: number
  capacity_breakdown?: {
    boys: CapacityBreakdownItem
    girls: CapacityBreakdownItem
    ag?: CapacityBreakdownItem
  }
}

interface PreValidationResultsModalProps {
  isOpen: boolean
  onClose: () => void
  results: {
    valid: boolean
    errors: string[]
    warnings: string[]
    statistics: ValidationStatistics
    impossibility_report: ImpossibilityReport
  }
  sessionId?: string
  sessionLookup: (cm_id: number) => string | undefined
}

// Parse capacity issues from error messages
interface ParsedCapacityIssue {
  area: string
  campers: number
  beds: number
  over: number
}

function parseCapacityIssues(errors: string[]): ParsedCapacityIssue[] {
  const issues: ParsedCapacityIssue[] = []

  for (const error of errors) {
    // Match "Gender capacity issues: Boys: 97 campers, 96 beds (1 OVER); Girls: ..."
    if (error.includes('capacity issues:')) {
      // Remove prefix, then split by semicolon only (keep colons intact for regex)
      const content = error.replace(/^.*?capacity issues:\s*/i, '')
      const parts = content.split(/;\s*/)
      for (const part of parts) {
        const match = part.match(/(\w+):\s*(\d+)\s*campers?,\s*(\d+)\s*beds?\s*\((\d+)\s*OVER\)/i)
        if (match?.[1] && match[2] && match[3] && match[4]) {
          issues.push({
            area: match[1].trim(),
            campers: parseInt(match[2], 10),
            beds: parseInt(match[3], 10),
            over: parseInt(match[4], 10),
          })
        }
      }
    }
    // Match simple capacity error
    const simpleMatch = error.match(
      /Insufficient capacity:\s*(\d+)\s*campers?\s*but only\s*(\d+)\s*beds/i
    )
    if (simpleMatch?.[1] && simpleMatch[2]) {
      issues.push({
        area: 'Total',
        campers: parseInt(simpleMatch[1], 10),
        beds: parseInt(simpleMatch[2], 10),
        over: parseInt(simpleMatch[1], 10) - parseInt(simpleMatch[2], 10),
      })
    }
  }

  return issues
}

// Parse warnings into structured data
interface ParsedWarning {
  type: 'conflict' | 'other'
  names?: { requester: string; requested: string }
  message: string
}

function parseWarnings(warnings: string[]): ParsedWarning[] {
  return warnings.map((warning) => {
    // Conflicting requests
    const conflictMatch = warning.match(/(.+?) has conflicting requests for (.+?) \(both/)
    if (conflictMatch?.[1] && conflictMatch[2]) {
      return {
        type: 'conflict' as const,
        names: {
          requester: conflictMatch[1].replace(/\s*\(\d+\)$/, ''),
          requested: conflictMatch[2].replace(/\s*\(\d+\)$/, ''),
        },
        message: warning,
      }
    }

    return {
      type: 'other' as const,
      message: warning.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper'),
    }
  })
}

// Get non-capacity errors (for display in "other" section)
function getNonCapacityErrors(errors: string[]): string[] {
  return errors
    .filter((e) => !e.includes('capacity issues:') && !e.match(/Insufficient capacity/i))
    .map((e) => e.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper'))
}

// Friendly labels for impossibility reason codes (staff view)
const FRIENDLY_REASON_LABELS: Record<string, string> = {
  grade_compatibility: 'Grade range too wide',
  cross_session: 'Different sessions',
  pair_no_shared_bunk: "Can't share a cabin",
  age_pref_no_eligible_grade: 'No matching age group available',
  malformed: 'Incomplete request',
  target_not_in_solver: 'Friend not enrolled',
  self_conflict: 'Contradicting requests',
}

function friendlyReasonLabel(code: string): string {
  return FRIENDLY_REASON_LABELS[code] || code
}

// Camper-level action hint: target_not_in_solver means the named friend isn't
// enrolled (confirm enrollment); any other reason means the request itself is
// the problem (fix parent input).
function camperActionHints(reasonCodes: string[]): string {
  const hints = new Set<string>()
  for (const code of reasonCodes) {
    hints.add(code === 'target_not_in_solver' ? 'confirm enrollment' : 'fix parent input')
  }
  return Array.from(hints).join(' / ')
}

function EntirelyImpossibleMpSection({ campers }: { campers: EntirelyImpossibleMpCamper[] }) {
  if (campers.length === 0) return null
  return (
    <details open className="rounded-lg border border-red-200 bg-red-50 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-red-900 [&::-webkit-details-marker]:hidden">
        <span>{campers.length} camper(s) will get zero parent requests honored</span>
        <span className="rounded-full bg-red-400 px-2 py-0.5 text-xs font-bold text-white">
          {campers.length}
        </span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-red-200 pt-2">
        {campers.map((c) => (
          <div key={c.cm_id} className="text-sm">
            <div className="font-medium">
              {c.name} ({c.gender}) · {ordinalGrade(c.grade)}
            </div>
            <div className="text-xs text-stone-600">{camperActionHints(c.reason_codes)}</div>
          </div>
        ))}
      </div>
    </details>
  )
}

function ordinalGrade(grade: number): string {
  // Short form (e.g. "5th") — staff scan name + grade + gender inline; the
  // trailing "grade" word adds noise without helping comprehension.
  const s = ['th', 'st', 'nd', 'rd']
  const v = grade % 100
  return `${grade}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function requestVerb(requestType: string): string {
  return requestType === 'not_bunk_with' ? "don't bunk with" : 'bunk with'
}

function renderSubtext(
  item: ImpossibilityReportItem,
  sessionLookup: (cm_id: number) => string | undefined
) {
  const r = item.requestee
  const verb = requestVerb(item.request_type)
  switch (item.reason_code) {
    case 'grade_compatibility':
      return r ? (
        <div className="text-xs text-stone-600">
          {verb}{' '}
          <strong>
            {r.name} ({r.gender})
          </strong>{' '}
          · {ordinalGrade(r.grade)}
        </div>
      ) : null

    case 'cross_session': {
      if (!r) return null
      const otherSessionCm = item.detail?.['requestee_session'] as number | undefined
      const sessionName =
        (otherSessionCm !== undefined ? sessionLookup(otherSessionCm) : undefined) ??
        (otherSessionCm !== undefined ? `Session ${otherSessionCm}` : 'a different session')
      return (
        <div className="text-xs text-stone-600">
          {verb}{' '}
          <strong>
            {r.name} ({r.gender})
          </strong>{' '}
          · {ordinalGrade(r.grade)} · in <strong>{sessionName}</strong> session
        </div>
      )
    }

    case 'pair_no_shared_bunk':
      return r ? (
        <div className="text-xs text-stone-600">
          {verb}{' '}
          <strong>
            {r.name} ({r.gender})
          </strong>{' '}
          · {ordinalGrade(r.grade)} — not AG session
        </div>
      ) : null

    case 'age_pref_no_eligible_grade': {
      const dir = item.detail?.['direction'] as 'older' | 'younger' | undefined
      if (dir === 'older' && item.detail?.['pool_max_grade'] !== undefined) {
        return (
          <div className="text-xs text-stone-600">
            <strong>Wants older</strong> — already at oldest grade
          </div>
        )
      }
      if (dir === 'younger' && item.detail?.['pool_min_grade'] !== undefined) {
        return (
          <div className="text-xs text-stone-600">
            <strong>Wants younger</strong> — already at youngest grade
          </div>
        )
      }
      if (dir) {
        return (
          <div className="text-xs text-stone-600">
            <strong>Wants {dir}</strong> — no same-gender peers
          </div>
        )
      }
      return null
    }

    case 'malformed':
      return (
        <div className="text-xs text-stone-600">
          <strong>Incomplete request</strong> — form is missing who they want to bunk with
        </div>
      )

    case 'target_not_in_solver':
      // requestee is null here — the named friend isn't on the roster, so we
      // have no person record to render. Give staff the actionable line.
      return (
        <div className="text-xs text-stone-600">
          Requested friend isn&rsquo;t enrolled in this session
        </div>
      )

    case 'self_conflict': {
      const conflictingType = item.detail?.['conflicting_type'] as string | undefined
      const conflictingVerb = conflictingType ? requestVerb(conflictingType) : 'do the opposite'
      return r ? (
        <div className="text-xs text-stone-600">
          {verb}{' '}
          <strong>
            {r.name} ({r.gender})
          </strong>{' '}
          · {ordinalGrade(r.grade)} — also marked <strong>{conflictingVerb}</strong>
        </div>
      ) : null
    }

    default:
      return r ? (
        <div className="text-xs text-stone-600">
          {verb}{' '}
          <strong>
            {r.name} ({r.gender})
          </strong>{' '}
          · {ordinalGrade(r.grade)}
        </div>
      ) : null
  }
}

function ImpossibilityItems({
  items,
  sessionLookup,
}: {
  items: ImpossibilityReportItem[]
  sessionLookup: (cm_id: number) => string | undefined
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-amber-200 pt-2">
      {items.map((item) => (
        // Composite key — a request can appear in multiple by_reason buckets
        // after the multi-reason fix; this component receives one bucket's
        // items so request_id is unique here, but include reason_code for
        // safety when callers later flatten.
        <div key={`${item.request_id}-${item.reason_code}`} className="text-sm">
          <div className="font-medium">
            {item.requester.name} ({item.requester.gender}) · {ordinalGrade(item.requester.grade)}
          </div>
          {renderSubtext(item, sessionLookup)}
        </div>
      ))}
    </div>
  )
}

// Capacity issue card component
function CapacityCard({ issue }: { issue: ParsedCapacityIssue }) {
  return (
    <div className="bg-destructive/8 border-destructive/20 flex items-center justify-between rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <div className="bg-destructive/15 flex h-8 w-8 items-center justify-center rounded-lg">
          <Users className="text-destructive h-4 w-4" />
        </div>
        <div>
          <span className="text-foreground font-medium">{issue.area}</span>
          <div className="text-muted-foreground text-xs">
            {issue.campers} campers · {issue.beds} beds
          </div>
        </div>
      </div>
      <span className="bg-destructive/15 text-destructive rounded-full px-2.5 py-1 text-xs font-semibold">
        +{issue.over} over
      </span>
    </div>
  )
}

// Conflict warning card
function ConflictCard({ names }: { names: { requester: string; requested: string } }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 p-2.5">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-500/15">
        <Zap className="h-3 w-3 text-amber-600" />
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="text-foreground truncate font-medium">{names.requester}</span>
        <span className="text-muted-foreground text-xs">⇄</span>
        <span className="text-foreground truncate font-medium">{names.requested}</span>
      </div>
      <span className="ml-auto text-xs whitespace-nowrap text-amber-600">conflict</span>
    </div>
  )
}

export default function PreValidationResultsModal({
  isOpen,
  onClose,
  results,
  sessionLookup,
}: PreValidationResultsModalProps) {
  const [showDetails, setShowDetails] = useState(false)

  const { valid, errors, warnings, statistics, impossibility_report } = results

  // Parse structured data from error messages
  const capacityIssues = useMemo(() => parseCapacityIssues(errors), [errors])
  const parsedWarnings = useMemo(() => parseWarnings(warnings), [warnings])
  const otherErrors = useMemo(() => getNonCapacityErrors(errors), [errors])

  const hasIssues =
    errors.length > 0 || warnings.length > 0 || impossibility_report.total_impossible > 0
  const showSuccess = valid && !hasIssues

  const requestRate =
    statistics.total_campers > 0
      ? Math.round((statistics.campers_with_requests / statistics.total_campers) * 100)
      : 0

  // Group warnings by type for cleaner display
  const conflictWarnings = parsedWarnings.filter((w) => w.type === 'conflict')
  const otherWarnings = parsedWarnings.filter((w) => w.type === 'other')

  const summaryClass = 'cursor-pointer list-none [&::-webkit-details-marker]:hidden'

  const headerContent = (
    <div
      className={`flex items-center gap-3 py-4 pr-14 pl-5 ${
        showSuccess
          ? 'from-forest-500/10 to-forest-400/5 bg-gradient-to-r'
          : 'bg-gradient-to-r from-amber-500/15 to-amber-400/5'
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          showSuccess
            ? 'bg-forest-500 shadow-forest-500/30 text-white shadow-lg'
            : 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
        }`}
      >
        {showSuccess ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <div>
        <h2 className="font-display text-foreground text-lg leading-tight font-bold">
          {showSuccess ? 'Ready to Run!' : 'Heads Up'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {showSuccess
            ? 'All requests look good'
            : `${errors.length + warnings.length + impossibility_report.total_impossible} thing${
                errors.length + warnings.length + impossibility_report.total_impossible !== 1
                  ? 's'
                  : ''
              } to review`}
        </p>
      </div>
    </div>
  )

  const footerContent = (
    <div className="bg-muted/30 border-border/50 flex justify-end gap-2 border-t px-5 py-4">
      <button
        onClick={onClose}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
          showSuccess
            ? 'bg-forest-500 hover:bg-forest-600 shadow-forest-500/20 text-white shadow-lg'
            : 'bg-muted hover:bg-muted/80 text-foreground'
        }`}
      >
        {showSuccess ? 'Got it!' : 'Close'}
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="md"
      noPadding
      scrollable
    >
      {/* Quick Stats Row */}
      <div className="border-border/50 bg-muted/30 flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-4 text-sm">
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Users className="text-forest-500 h-4 w-4" />
            <span className="text-foreground font-medium">{statistics.total_campers}</span>
            <span>campers</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Home className="text-forest-500 h-4 w-4" />
            <span className="text-foreground font-medium">{statistics.total_bunks}</span>
            <span>bunks</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Heart className="text-forest-500 h-4 w-4" />
            <span className="text-foreground font-medium">{requestRate}%</span>
            <span>have requests</span>
          </div>
        </div>
      </div>

      {/* Issues Display - Visual cards instead of text */}
      {hasIssues && (
        <div className="max-h-72 space-y-3 overflow-y-auto px-5 py-4">
          {/* Capacity Issues - Visual cards */}
          {capacityIssues.length > 0 && (
            <div className="space-y-2">
              <p className="text-destructive flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <Zap className="h-3 w-3" />
                Capacity Issues
              </p>
              {capacityIssues.map((issue, i) => (
                <CapacityCard key={i} issue={issue} />
              ))}
            </div>
          )}

          {/* Other errors (non-capacity) */}
          {otherErrors.length > 0 && (
            <div className="space-y-2">
              {otherErrors.map((err, i) => (
                <div
                  key={i}
                  className="bg-destructive/8 border-destructive/20 flex items-center gap-2.5 rounded-xl border p-3"
                >
                  <Zap className="text-destructive h-4 w-4 flex-shrink-0" />
                  <span className="text-foreground text-sm">{err}</span>
                </div>
              ))}
            </div>
          )}

          {/* Conflict warnings - compact cards */}
          {conflictWarnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-amber-600 uppercase">
                <Zap className="h-3 w-3" />
                Conflicting Requests
              </p>
              {conflictWarnings.map((w, i) => w.names && <ConflictCard key={i} names={w.names} />)}
            </div>
          )}

          {/* Other warnings */}
          {otherWarnings.length > 0 && (
            <div className="space-y-1.5">
              {otherWarnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 p-2.5"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
                  <span className="text-foreground text-sm">{w.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Success state message */}
      {!hasIssues && (
        <div className="px-5 py-6 text-center">
          <div className="bg-forest-500/10 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Sparkles className="text-forest-500 h-6 w-6" />
          </div>
          <p className="text-muted-foreground text-sm">
            No conflicts found. The optimizer should find a solution.
          </p>
        </div>
      )}

      {/* Impossibility Report — staff view */}
      <div className="space-y-3 px-5 py-4">
        <EntirelyImpossibleMpSection
          campers={impossibility_report.mp_campers_entirely_impossible ?? []}
        />
        {impossibility_report.total_impossible === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="mr-2 inline-block h-5 w-5" />
            No impossible requests found for this scenario.
          </div>
        ) : (
          <>
            {Object.entries(impossibility_report.by_reason).map(([code, items]) => (
              <details
                key={code}
                open
                className="rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <summary
                  className={`flex items-center justify-between font-semibold text-amber-900 ${summaryClass}`}
                >
                  <span>{friendlyReasonLabel(code)}</span>
                  <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-white">
                    {items.length}
                  </span>
                </summary>
                <ImpossibilityItems items={items} sessionLookup={sessionLookup} />
              </details>
            ))}
          </>
        )}
      </div>

      {/* Collapsible Details */}
      {(impossibility_report.total_impossible > 0 || hasIssues) && (
        <div className="border-border/50 border-t">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/30 flex w-full items-center justify-between px-5 py-3 text-sm transition-colors"
          >
            <span>Details for nerds</span>
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showDetails && (
            <div className="animate-fade-in space-y-3 px-5 pb-4">
              {/* Gender capacity breakdown */}
              {statistics.capacity_breakdown && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Capacity by Area
                  </p>
                  <div
                    className={`grid gap-2 text-xs ${statistics.capacity_breakdown.ag && statistics.capacity_breakdown.ag.campers > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}
                  >
                    <div
                      className={`rounded-lg p-2 ${
                        statistics.capacity_breakdown.boys.sufficient
                          ? 'bg-forest-500/10 border-forest-500/20 border'
                          : 'border border-red-500/20 bg-red-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium">Boys</span>
                        <span
                          className={
                            statistics.capacity_breakdown.boys.sufficient
                              ? 'text-forest-600'
                              : 'text-red-600'
                          }
                        >
                          {statistics.capacity_breakdown.boys.sufficient
                            ? '✓'
                            : `${statistics.capacity_breakdown.boys.campers - statistics.capacity_breakdown.boys.beds} over`}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {statistics.capacity_breakdown.boys.campers} /{' '}
                        {statistics.capacity_breakdown.boys.beds}
                      </div>
                    </div>
                    <div
                      className={`rounded-lg p-2 ${
                        statistics.capacity_breakdown.girls.sufficient
                          ? 'bg-forest-500/10 border-forest-500/20 border'
                          : 'border border-red-500/20 bg-red-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium">Girls</span>
                        <span
                          className={
                            statistics.capacity_breakdown.girls.sufficient
                              ? 'text-forest-600'
                              : 'text-red-600'
                          }
                        >
                          {statistics.capacity_breakdown.girls.sufficient
                            ? '✓'
                            : `${statistics.capacity_breakdown.girls.campers - statistics.capacity_breakdown.girls.beds} over`}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {statistics.capacity_breakdown.girls.campers} /{' '}
                        {statistics.capacity_breakdown.girls.beds}
                      </div>
                    </div>
                    {/* AG column - only shown if there are AG campers */}
                    {statistics.capacity_breakdown.ag &&
                      statistics.capacity_breakdown.ag.campers > 0 && (
                        <div
                          className={`rounded-lg p-2 ${
                            statistics.capacity_breakdown.ag.sufficient
                              ? 'bg-forest-500/10 border-forest-500/20 border'
                              : 'border border-red-500/20 bg-red-500/10'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-foreground font-medium">AG</span>
                            <span
                              className={
                                statistics.capacity_breakdown.ag.sufficient
                                  ? 'text-forest-600'
                                  : 'text-red-600'
                              }
                            >
                              {statistics.capacity_breakdown.ag.sufficient
                                ? '✓'
                                : `${statistics.capacity_breakdown.ag.campers - statistics.capacity_breakdown.ag.beds} over`}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {statistics.capacity_breakdown.ag.campers} /{' '}
                            {statistics.capacity_breakdown.ag.beds}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Detailed stats - compact grid */}
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="bg-muted/50 rounded-lg p-2 text-center">
                  <div className="text-foreground font-semibold">{statistics.total_capacity}</div>
                  <div className="text-muted-foreground text-[10px]">beds</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-2 text-center">
                  <div className="text-foreground font-semibold">{statistics.total_requests}</div>
                  <div className="text-muted-foreground text-[10px]">requests</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-2 text-center">
                  <div className="text-foreground font-semibold">
                    {statistics.campers_with_requests}
                  </div>
                  <div className="text-muted-foreground text-[10px]">w/ reqs</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-2 text-center">
                  <div className="text-foreground font-semibold">
                    {statistics.campers_without_requests}
                  </div>
                  <div className="text-muted-foreground text-[10px]">no reqs</div>
                </div>
              </div>

              {/* Tip for capacity issues */}
              {capacityIssues.length > 0 && (
                <div className="text-muted-foreground bg-primary/5 border-primary/10 rounded-lg border p-2 text-xs">
                  <span className="text-primary font-medium">Tip:</span> Capacity issues must be
                  resolved before running. Check bunk counts or camper enrollment.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
