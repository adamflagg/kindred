import { useState } from 'react'
import {
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Users,
  Home,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
} from 'lucide-react'

interface FieldStats {
  total: number
  satisfied: number
  satisfaction_rate: number
}

interface ValidationStatistics {
  total_campers: number
  assigned_campers: number
  unassigned_campers: number
  total_requests: number
  satisfied_requests: number
  request_satisfaction_rate: number
  bunks_at_capacity: number
  bunks_under_capacity: number
  bunks_over_capacity: number

  field_stats: {
    [key: string]: FieldStats
  }
}

interface Issue {
  type: string
  severity: string
  message: string
  details?: Record<string, unknown>
}

interface ValidationResults {
  statistics: ValidationStatistics
  issues: Issue[]
  validated_at: string
}

interface ValidationResultsModalProps {
  isOpen: boolean
  onClose: () => void
  results: ValidationResults
  sessionId: string
  scenarioId?: string
}

// Group issues by their type for better display
function groupIssuesByType(issues: Issue[]): Map<string, Issue[]> {
  const grouped = new Map<string, Issue[]>()
  for (const issue of issues) {
    const existing = grouped.get(issue.type) ?? []
    existing.push(issue)
    grouped.set(issue.type, existing)
  }
  return grouped
}

// Get a human-readable label for issue types
function getIssueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    unsatisfied_request: 'Unsatisfied Requests',
    capacity_exceeded: 'Over Capacity',
    age_spread: 'Age Spread Issues',
    grade_imbalance: 'Grade Imbalance',
    unassigned_camper: 'Unassigned Campers',
    conflicting_request: 'Conflicting Requests',
  }
  return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

interface CollapsibleIssueGroupProps {
  type: string
  issues: Issue[]
  severity: string
  defaultExpanded?: boolean
}

function CollapsibleIssueGroup({
  type,
  issues,
  severity,
  defaultExpanded = false,
}: CollapsibleIssueGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const getSeverityStyles = () => {
    switch (severity) {
      case 'error':
        return {
          bg: 'bg-destructive/10',
          border: 'border-destructive/30',
          text: 'text-destructive',
          headerBg: 'bg-destructive/5',
        }
      case 'warning':
        return {
          bg: 'bg-accent/10',
          border: 'border-accent/30',
          text: 'text-accent-foreground',
          headerBg: 'bg-accent/5',
        }
      default:
        return {
          bg: 'bg-primary/10',
          border: 'border-primary/30',
          text: 'text-primary',
          headerBg: 'bg-primary/5',
        }
    }
  }

  const styles = getSeverityStyles()
  const showPreview = !isExpanded && issues.length <= 3
  const showCount = issues.length > 3

  return (
    <div className={`rounded-xl border ${styles.border} overflow-hidden`}>
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex w-full items-center justify-between px-4 py-3 ${styles.headerBg} hover:bg-muted/50 transition-colors`}
      >
        <div className="flex items-center gap-3">
          {severity === 'error' && <AlertTriangle className={`h-4 w-4 ${styles.text}`} />}
          {severity === 'warning' && <AlertCircle className={`h-4 w-4 ${styles.text}`} />}
          {severity === 'info' && <Info className={`h-4 w-4 ${styles.text}`} />}
          <span className={`font-medium ${styles.text}`}>{getIssueTypeLabel(type)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${styles.bg} ${styles.text}`}>
            {issues.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        )}
      </button>

      {/* Preview for small lists when collapsed */}
      {showPreview && (
        <div className={`px-4 py-2 ${styles.bg} border-t ${styles.border}`}>
          <ul className="space-y-1 text-sm">
            {issues.map((issue, idx) => (
              <li key={idx} className={`${styles.text} opacity-80`}>
                • {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Count hint when collapsed with many items */}
      {!isExpanded && showCount && (
        <div className={`px-4 py-2 ${styles.bg} border-t ${styles.border}`}>
          <p className={`text-sm ${styles.text} opacity-70`}>
            Click to view all {issues.length} issues...
          </p>
        </div>
      )}

      {/* Expanded list */}
      {isExpanded && (
        <div className={`${styles.bg} border-t ${styles.border} max-h-64 overflow-y-auto`}>
          <ul className="divide-border/50 divide-y">
            {issues.map((issue, idx) => (
              <li key={idx} className="px-4 py-2">
                <p className={`text-sm ${styles.text}`}>{issue.message}</p>
                {issue.details && Object.keys(issue.details).length > 0 && (
                  <div className="mt-1 text-xs opacity-70">
                    {Object.entries(issue.details).map(([key, value]) => (
                      <span key={key} className="mr-3">
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function ValidationResultsModal({
  isOpen,
  onClose,
  results,
  scenarioId,
}: ValidationResultsModalProps) {
  if (!isOpen) return null

  const { statistics, issues } = results

  // Group issues by severity first, then by type
  const errorIssues = issues.filter((i) => i.severity === 'error')
  const warningIssues = issues.filter((i) => i.severity === 'warning')
  const infoIssues = issues.filter((i) => i.severity === 'info')

  const errorsByType = groupIssuesByType(errorIssues)
  const warningsByType = groupIssuesByType(warningIssues)
  const infosByType = groupIssuesByType(infoIssues)

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`
  }

  const hasIssues = issues.length > 0
  const satisfactionRate = statistics.request_satisfaction_rate

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="card-lodge shadow-lodge-lg animate-scale-in max-h-[90vh] w-full max-w-4xl overflow-hidden">
        {/* Header */}
        <div className="bg-muted/50 border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-display text-foreground flex items-center gap-2 text-xl font-bold">
            <ClipboardCheck className="text-primary h-5 w-5" />
            Post-Check Results
            {scenarioId && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">(Scenario)</span>
            )}
          </h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-8rem)] overflow-y-auto">
          {/* Overall Status Banner */}
          <div
            className={`flex items-start gap-4 px-6 py-4 ${
              satisfactionRate >= 0.8
                ? 'bg-primary/10 border-primary/20 border-b'
                : satisfactionRate >= 0.5
                  ? 'bg-accent/10 border-accent/20 border-b'
                  : 'bg-destructive/10 border-destructive/20 border-b'
            }`}
          >
            {satisfactionRate >= 0.8 ? (
              <>
                <div className="bg-primary/20 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full">
                  <CheckCircle className="text-primary h-5 w-5" />
                </div>
                <div>
                  <p className="text-primary font-semibold">Looking Good!</p>
                  <p className="text-primary/80 mt-0.5 text-sm">
                    {formatPercentage(satisfactionRate)} of requests are satisfied.
                  </p>
                </div>
              </>
            ) : satisfactionRate >= 0.5 ? (
              <>
                <div className="bg-accent/20 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full">
                  <AlertCircle className="text-accent-foreground h-5 w-5" />
                </div>
                <div>
                  <p className="text-accent-foreground font-semibold">Needs Attention</p>
                  <p className="text-accent-foreground/80 mt-0.5 text-sm">
                    {formatPercentage(satisfactionRate)} of requests are satisfied. Review the
                    issues below.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-destructive/20 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full">
                  <AlertTriangle className="text-destructive h-5 w-5" />
                </div>
                <div>
                  <p className="text-destructive font-semibold">Significant Issues</p>
                  <p className="text-destructive/80 mt-0.5 text-sm">
                    Only {formatPercentage(satisfactionRate)} of requests are satisfied. Consider
                    re-running the solver.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Statistics Summary */}
          <div className="border-border border-b p-6">
            <h3 className="text-muted-foreground mb-4 text-sm font-medium tracking-wider uppercase">
              Summary
            </h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="bg-muted/50 rounded-xl p-4">
                <div className="text-muted-foreground mb-1 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">Campers</span>
                </div>
                <div className="text-foreground text-2xl font-semibold">
                  {statistics.assigned_campers}/{statistics.total_campers}
                </div>
                <div className="text-muted-foreground text-sm">
                  {statistics.unassigned_campers > 0 ? (
                    <span className="text-accent-foreground">
                      {statistics.unassigned_campers} unassigned
                    </span>
                  ) : (
                    <span>All assigned</span>
                  )}
                </div>
              </div>

              <div className="bg-muted/50 rounded-xl p-4">
                <div className="text-muted-foreground mb-1 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Requests</span>
                </div>
                <div className="text-foreground text-2xl font-semibold">
                  {statistics.satisfied_requests}/{statistics.total_requests}
                </div>
                <div
                  className={`text-sm ${
                    satisfactionRate >= 0.8
                      ? 'text-primary'
                      : satisfactionRate >= 0.5
                        ? 'text-accent-foreground'
                        : 'text-destructive'
                  }`}
                >
                  {formatPercentage(satisfactionRate)} satisfied
                </div>
              </div>

              <div className="bg-muted/50 rounded-xl p-4">
                <div className="text-muted-foreground mb-1 flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  <span className="text-sm">Bunks</span>
                </div>
                <div className="text-foreground text-2xl font-semibold">
                  {statistics.bunks_at_capacity +
                    statistics.bunks_under_capacity +
                    statistics.bunks_over_capacity}
                </div>
                <div className="text-muted-foreground text-sm">
                  {statistics.bunks_over_capacity > 0 ? (
                    <span className="text-destructive">
                      {statistics.bunks_over_capacity} over capacity
                    </span>
                  ) : (
                    <span>All within capacity</span>
                  )}
                </div>
              </div>

              {/* Quick issue count */}
              <div className="bg-muted/50 rounded-xl p-4">
                <div className="text-muted-foreground mb-1 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">Issues</span>
                </div>
                <div className="text-foreground text-2xl font-semibold">{issues.length}</div>
                <div className="text-muted-foreground text-sm">
                  {errorIssues.length > 0 && (
                    <span className="text-destructive mr-2">{errorIssues.length} errors</span>
                  )}
                  {warningIssues.length > 0 && (
                    <span className="text-accent-foreground">{warningIssues.length} warnings</span>
                  )}
                  {issues.length === 0 && <span className="text-primary">All clear!</span>}
                </div>
              </div>
            </div>
          </div>

          {/* CSV Field Source Breakdown */}
          {Object.keys(statistics.field_stats).length > 0 && (
            <div className="border-border border-b p-6">
              <h3 className="text-muted-foreground mb-4 text-sm font-medium tracking-wider uppercase">
                By Request Source
              </h3>
              <div className="bg-muted/30 overflow-hidden rounded-xl">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                        Field
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                        Total
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                        Satisfied
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                        Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {Object.entries(statistics.field_stats)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([fieldName, stats]) => {
                        const formattedFieldName = fieldName
                          .replace(/_/g, ' ')
                          .replace(/\b\w/g, (l) => l.toUpperCase())

                        return (
                          <tr key={fieldName} className="bg-card hover:bg-muted/30">
                            <td className="text-foreground px-4 py-3 text-sm font-medium">
                              {formattedFieldName}
                            </td>
                            <td className="text-muted-foreground px-4 py-3 text-center text-sm">
                              {stats.total}
                            </td>
                            <td className="text-muted-foreground px-4 py-3 text-center text-sm">
                              {stats.satisfied}
                            </td>
                            <td className="px-4 py-3 text-center text-sm">
                              <span
                                className={`inline-flex items-center rounded-xl px-2.5 py-0.5 text-xs font-medium ${
                                  stats.satisfaction_rate >= 0.8
                                    ? 'bg-primary/20 text-primary'
                                    : stats.satisfaction_rate >= 0.5
                                      ? 'bg-accent/20 text-accent-foreground'
                                      : 'bg-destructive/20 text-destructive'
                                }`}
                              >
                                {formatPercentage(stats.satisfaction_rate)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Issues - Grouped and Collapsible */}
          <div className="p-6">
            <h3 className="text-muted-foreground mb-4 text-sm font-medium tracking-wider uppercase">
              Issues Detail
            </h3>

            {!hasIssues ? (
              <div className="py-8 text-center">
                <CheckCircle className="text-primary mx-auto mb-3 h-12 w-12" />
                <p className="text-muted-foreground">
                  No issues found! All bunking assignments look good.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Errors */}
                {Array.from(errorsByType.entries()).map(([type, typeIssues]) => (
                  <CollapsibleIssueGroup
                    key={`error-${type}`}
                    type={type}
                    issues={typeIssues}
                    severity="error"
                    defaultExpanded={typeIssues.length <= 5}
                  />
                ))}

                {/* Warnings */}
                {Array.from(warningsByType.entries()).map(([type, typeIssues]) => (
                  <CollapsibleIssueGroup
                    key={`warning-${type}`}
                    type={type}
                    issues={typeIssues}
                    severity="warning"
                    defaultExpanded={typeIssues.length <= 5}
                  />
                ))}

                {/* Info */}
                {Array.from(infosByType.entries()).map(([type, typeIssues]) => (
                  <CollapsibleIssueGroup
                    key={`info-${type}`}
                    type={type}
                    issues={typeIssues}
                    severity="info"
                    defaultExpanded={typeIssues.length <= 5}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-muted/50 border-border border-t px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-sm">
              Validated at {new Date(results.validated_at).toLocaleString()}
            </div>
            <button onClick={onClose} className="btn-primary">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
