import { useState, useMemo } from 'react'
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
  ArrowRight,
  UserMinus,
} from 'lucide-react'
import { Modal } from './ui/Modal'

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
  unsatisfiable_requests: Array<{
    requester: string
    requester_name?: string
    request_type: string
    requested_cm_id: string
    requested_name?: string
    reason: string
  }>
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
  }
  sessionId: string
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
  type: 'conflict' | 'unsatisfiable' | 'other'
  count?: number
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

    // Unsatisfiable/unfulfillable requests - multiple formats
    // "1 camper has requests that may not be fulfilled"
    // "5 campers have requests that may not be fulfilled"
    // "X camper(s) have only unsatisfiable requests"
    const unsatMatch = warning.match(/(\d+) campers? ha(?:ve|s)(?: only unsatisfiable)? requests/i)
    if (unsatMatch?.[1]) {
      return {
        type: 'unsatisfiable' as const,
        count: parseInt(unsatMatch[1], 10),
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

// Translate technical reasons into friendly labels
function friendlyReason(reason: string): string {
  const lowerReason = reason.toLowerCase()
  if (lowerReason.includes('not in session') || lowerReason.includes('not enrolled')) {
    return 'Not enrolled'
  }
  if (lowerReason.includes('gender') || lowerReason.includes('different area')) {
    return 'Different area'
  }
  if (lowerReason.includes('age') || lowerReason.includes('spread')) {
    return 'Age/grade gap'
  }
  if (lowerReason.includes('conflict')) {
    return 'Conflict'
  }
  return reason.length > 20 ? reason.slice(0, 17) + '...' : reason
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

// Unsatisfiable count badge
function UnsatisfiableBadge({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15">
        <UserMinus className="h-4 w-4 text-amber-600" />
      </div>
      <div>
        <span className="text-foreground font-medium">{count} unfulfillable</span>
        <div className="text-muted-foreground text-xs">
          request{count !== 1 ? 's' : ''} can't be met
        </div>
      </div>
    </div>
  )
}

export default function PreValidationResultsModal({
  isOpen,
  onClose,
  results,
}: PreValidationResultsModalProps) {
  const [showDetails, setShowDetails] = useState(false)

  const { valid, errors, warnings, statistics } = results

  // Parse structured data from error messages
  const capacityIssues = useMemo(() => parseCapacityIssues(errors), [errors])
  const parsedWarnings = useMemo(() => parseWarnings(warnings), [warnings])
  const otherErrors = useMemo(() => getNonCapacityErrors(errors), [errors])

  const hasIssues = errors.length > 0 || warnings.length > 0
  const requestRate =
    statistics.total_campers > 0
      ? Math.round((statistics.campers_with_requests / statistics.total_campers) * 100)
      : 0

  // Group warnings by type for cleaner display
  const conflictWarnings = parsedWarnings.filter((w) => w.type === 'conflict')
  const unsatisfiableWarning = parsedWarnings.find((w) => w.type === 'unsatisfiable')
  const otherWarnings = parsedWarnings.filter((w) => w.type === 'other')

  const headerContent = (
    <div
      className={`flex items-center gap-3 py-4 pr-14 pl-5 ${
        valid
          ? 'from-forest-500/10 to-forest-400/5 bg-gradient-to-r'
          : 'bg-gradient-to-r from-amber-500/15 to-amber-400/5'
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          valid
            ? 'bg-forest-500 shadow-forest-500/30 text-white shadow-lg'
            : 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
        }`}
      >
        {valid ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <div>
        <h2 className="font-display text-foreground text-lg leading-tight font-bold">
          {valid ? 'Ready to Run!' : 'Heads Up'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {valid
            ? 'All requests look good'
            : `${errors.length + warnings.length} thing${errors.length + warnings.length > 1 ? 's' : ''} to review`}
        </p>
      </div>
    </div>
  )

  const footerContent = (
    <div className="bg-muted/30 border-border/50 flex justify-end gap-2 border-t px-5 py-4">
      <button
        onClick={onClose}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
          valid
            ? 'bg-forest-500 hover:bg-forest-600 shadow-forest-500/20 text-white shadow-lg'
            : 'bg-muted hover:bg-muted/80 text-foreground'
        }`}
      >
        {valid ? 'Got it!' : 'Close'}
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="sm"
      noPadding
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

          {/* Unsatisfiable requests badge */}
          {unsatisfiableWarning && <UnsatisfiableBadge count={unsatisfiableWarning.count ?? 1} />}

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

      {/* Collapsible Details */}
      {(statistics.unsatisfiable_requests.length > 0 || hasIssues) && (
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

              {/* Unsatisfiable requests detail - compact table */}
              {statistics.unsatisfiable_requests.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Unfulfillable Requests
                  </p>
                  <div className="border-border/50 max-h-32 overflow-y-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <tbody className="divide-border/30 divide-y">
                        {statistics.unsatisfiable_requests.map((req, index) => (
                          <tr key={index} className="hover:bg-muted/30">
                            <td className="text-foreground max-w-[120px] truncate px-2 py-1.5">
                              {req.requester_name ?? 'Unknown'}
                            </td>
                            <td className="text-muted-foreground px-1 py-1.5 text-center">
                              <ArrowRight className="inline h-3 w-3" />
                            </td>
                            <td className="text-foreground max-w-[120px] truncate px-2 py-1.5">
                              {req.requested_name ?? 'Unknown'}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                                {friendlyReason(req.reason)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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
