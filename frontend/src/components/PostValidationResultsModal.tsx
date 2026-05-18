import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  BUNK_LEVEL_ISSUE_TYPES,
  SUPPRESSED_ISSUE_TYPES,
  extractBunkName,
  type PostCheckIssue,
} from './issueClassifier'
import { formatBunkIssueDetail } from '../utils/validationIssueFormatter'
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Users,
  Home,
  Heart,
  Sparkles,
  TrendingUp,
  Target,
  Activity,
} from 'lucide-react'
import { Modal } from './ui/Modal'
import { LazyPdfExportButton } from './PdfExport/LazyPdfExportButton'
import { formatSourceField } from '../utils/formatSourceField'
import { LazyCamperDetailsPanel } from './impossibility/LazyCamperDetailsPanel'
import { friendlyReasonLabel } from './impossibility/reasonHints'
import { buildFamilyRows } from './PdfExport/familyRows'
import { ErrorBoundary } from './ErrorBoundary'
import type { ImpossibilityReport, ValidationStatistics } from '../services/solver'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'
import { useAuth } from '../contexts/AuthContext'
import { getLogoPath } from '../config/branding'

interface ValidationResults {
  statistics: ValidationStatistics
  issues: PostCheckIssue[]
  validated_at: string
}

interface PostValidationResultsModalProps {
  isOpen: boolean
  onClose: () => void
  results: ValidationResults
  scenarioId?: string | undefined
  /**
   * CampMinder session id. Required so the click-through CamperDetailsPanel
   * can mount inside a session-scoped BunkRequestProvider — SessionHeader
   * (where the Check-Bunking button lives) sits outside SessionView's
   * provider tree.
   */
  sessionCmId: number
  /**
   * Impossibility data from the most recent pre-check. Optional — when absent
   * (e.g., user opened post-check without pre-checking first), the section is
   * simply hidden. Impossibility is an input-feasibility property and is the
   * same regardless of solver assignments, so showing the pre-check report
   * here closes the loop on "we got 100% — who didn't get fulfilled?"
   */
  impossibilityReport?: ImpossibilityReport | undefined
  /**
   * True when the pre-check fetch failed. Surfaces a small notice in lieu of
   * the impossibility section so users don't mistake "fetch failed" for "no
   * impossibilities."
   */
  preCheckError?: boolean | undefined
  /**
   * Human-readable session name for the PDF export filename and header.
   * Falls back to the sessionCmId string when not provided.
   */
  sessionName?: string | undefined
  /**
   * Camp year for the PDF export filename and header.
   */
  year?: number | undefined
}

// Parse issue into structured display data
interface ParsedIssue {
  primary: string
  secondary?: string
  badge?: string
  badgeColor?: 'red' | 'amber' | 'muted'
  // For grade ratio - show all grades with counts
  gradeRatio?: {
    grades: Array<{ grade: number; count: number }>
    total: number
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- Utility function exported for testing
export function parseIssueMessage(issue: PostCheckIssue): ParsedIssue {
  const msg = issue.message

  // Handle unsatisfied request messages
  const unsatMatch = msg.match(/Request from (.+?) to (?:bunk with|avoid) (.+?) not satisfied/i)
  if (unsatMatch?.[1] && unsatMatch[2]) {
    const requester = unsatMatch[1].replace(/\s*\(\d+\)$/, '').trim()
    const requested = unsatMatch[2].replace(/\s*\(\d+\)$/, '').trim()
    return { primary: requester, secondary: requested }
  }

  // Handle capacity exceeded
  const capacityMatch = msg.match(/Bunk (.+?) is over capacity.*?(\d+).*?(\d+)/i)
  if (capacityMatch?.[1]) {
    const over =
      capacityMatch[2] && capacityMatch[3]
        ? parseInt(capacityMatch[2]) - parseInt(capacityMatch[3])
        : null
    return {
      primary: capacityMatch[1],
      badge: over ? `+${over}` : 'over',
      badgeColor: 'red',
    }
  }

  // Handle unassigned campers
  const unassignedMatch = msg.match(/(.+?) is not assigned to any bunk/i)
  if (unassignedMatch?.[1]) {
    const name = unassignedMatch[1].replace(/\s*\(\d+\)$/, '').trim()
    return { primary: name, badge: 'no bunk', badgeColor: 'red' }
  }

  // Handle level regression messages
  const regressionMatch = msg.match(
    /(.+?) was in (.+?) last year but is now in (.+?) \(regression of (\d+) level/i
  )
  if (regressionMatch?.[1] && regressionMatch[2] && regressionMatch[3] && regressionMatch[4]) {
    const name = regressionMatch[1].replace(/\s*\(\d+\)$/, '').trim()
    return {
      primary: name,
      secondary: `${regressionMatch[2]} → ${regressionMatch[3]}`,
      badge: `−${regressionMatch[4]}`,
      badgeColor: 'amber',
    }
  }

  // Handle age flow inversion messages
  const ageFlowMatch = msg.match(
    /(.+?) \(avg age ([\d.]+)\) has older campers than (.+?) \(avg age ([\d.]+)\)/i
  )
  if (ageFlowMatch?.[1] && ageFlowMatch[2] && ageFlowMatch[3] && ageFlowMatch[4]) {
    return {
      primary: `${ageFlowMatch[1]} > ${ageFlowMatch[3]}`,
      badge: `${ageFlowMatch[2]} vs ${ageFlowMatch[4]}`,
      badgeColor: 'amber',
    }
  }

  // Handle isolation risk messages
  const isolationMatch = msg.match(/(.+?) has (\d+) connected friends \+ (\d+) isolated camper/i)
  if (isolationMatch?.[1] && isolationMatch[2] && isolationMatch[3]) {
    return {
      primary: isolationMatch[1],
      secondary: `${isolationMatch[2]} friends`,
      badge: `${isolationMatch[3]} alone`,
      badgeColor: 'amber',
    }
  }

  // Handle grade ratio warning messages - use all_grades for full breakdown
  // "Bunk B-6 has 75.0% of campers from grade 5 (exceeds 67% limit)"
  if (issue.type === 'grade_ratio_warning' && issue.details) {
    const d = issue.details as {
      bunk_name?: string
      total?: number
      all_grades?: Record<string, number> // { "7": 9, "6": 3 }
    }
    if (d.bunk_name && d.total !== undefined && d.all_grades) {
      // Convert all_grades object to sorted array (already sorted by count desc from backend)
      const grades = Object.entries(d.all_grades).map(([g, c]) => ({
        grade: parseInt(g, 10),
        count: c,
      }))
      return {
        primary: d.bunk_name,
        gradeRatio: { grades, total: d.total },
      }
    }
  }
  // Fallback regex for grade ratio if details not available
  const gradeRatioMatch = msg.match(/Bunk (.+?) has ([\d.]+)% of campers from grade (\d+)/i)
  if (gradeRatioMatch?.[1] && gradeRatioMatch[2] && gradeRatioMatch[3]) {
    const percentage = parseFloat(gradeRatioMatch[2])
    const grade = parseInt(gradeRatioMatch[3], 10)
    const estimatedTotal = 12
    const estimatedCount = Math.round((percentage / 100) * estimatedTotal)
    return {
      primary: gradeRatioMatch[1],
      gradeRatio: {
        grades: [
          { grade, count: estimatedCount },
          { grade: grade - 1, count: estimatedTotal - estimatedCount },
        ],
        total: estimatedTotal,
      },
    }
  }

  // Handle grade spread warning messages
  // "Bunk B-5 has too many different grades (4 grades, max allowed: 3)"
  const gradeSpreadMatch = msg.match(
    /Bunk (.+?) has too many different grades \((\d+) grades?, max.*?(\d+)\)/i
  )
  if (gradeSpreadMatch?.[1] && gradeSpreadMatch[2] && gradeSpreadMatch[3]) {
    return {
      primary: gradeSpreadMatch[1],
      badge: `${gradeSpreadMatch[2]}/${gradeSpreadMatch[3]} grades`,
      badgeColor: 'amber',
    }
  }

  // Handle grade adjacency warning messages
  // "Bunk B-5 has non-adjacent grades [2, 4] (missing grade 3)"
  const gradeAdjMatch = msg.match(/Bunk (.+?) has non-adjacent grades.*missing grades? (.+?)\)/i)
  if (gradeAdjMatch?.[1] && gradeAdjMatch[2]) {
    return {
      primary: gradeAdjMatch[1],
      badge: `gap: gr ${gradeAdjMatch[2]}`,
      badgeColor: 'amber',
    }
  }

  // Handle unsatisfied request summary messages (two variants with identical display)
  const unsatisfiedPatterns = [
    /(\d+) campers? have bunking requests but none were satisfied/i,
    /(\d+) campers? have valid requests but NONE are satisfied/i,
  ]
  for (const pattern of unsatisfiedPatterns) {
    const match = msg.match(pattern)
    if (match?.[1]) {
      const count = parseInt(match[1])
      return {
        primary: `${count} camper${count !== 1 ? 's' : ''}`,
        badge: '0 satisfied',
        badgeColor: 'red' as const,
      }
    }
  }

  // Handle negative request violated messages
  const negReqMatch = msg.match(/(\d+) 'not bunk with' request\(s\) violated/i)
  if (negReqMatch?.[1]) {
    return {
      primary: `${negReqMatch[1]} "avoid" request${parseInt(negReqMatch[1]) > 1 ? 's' : ''}`,
      badge: 'violated',
      badgeColor: 'red',
    }
  }

  // Fallback - clean up the message
  const cleaned = msg.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper')
  return {
    primary: cleaned.length > 40 ? cleaned.slice(0, 37) + '...' : cleaned,
  }
}

// Get a human-readable label for issue types
// eslint-disable-next-line react-refresh/only-export-components -- Utility function exported for testing
export function getIssueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    unsatisfied_request: 'Unfulfilled Requests',
    capacity_exceeded: 'Over Capacity',
    age_spread: 'Age Spread Issues',
    grade_imbalance: 'Grade Imbalance',
    unassigned_camper: 'Unassigned Campers',
    conflicting_request: 'Conflicting Requests',
    level_regression: 'Level Regression',
    age_flow_inversion: 'Age Flow Issues',
    isolation_risk: 'Isolation Risk',
    no_requests_satisfied: 'No Requests Met',
    negative_request_violated: 'Separation Violated',
    campers_with_unsatisfied_valid_requests: 'Unsatisfied Requests',
  }
  return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

// Satisfaction ring component - the visual centerpiece
function SatisfactionRing({ rate, size = 120 }: { rate: number; size?: number }) {
  const percentage = Math.round(rate * 100)
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - rate * circumference

  // Color based on satisfaction rate
  const getColor = () => {
    if (rate >= 0.8)
      return {
        stroke: 'stroke-forest-500',
        text: 'text-forest-600',
        bg: 'bg-forest-500',
      }
    if (rate >= 0.6)
      return {
        stroke: 'stroke-amber-500',
        text: 'text-amber-600',
        bg: 'bg-amber-500',
      }
    return { stroke: 'stroke-red-500', text: 'text-red-600', bg: 'bg-red-500' }
  }

  const colors = getColor()

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90 transform">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={`${colors.stroke} transition-all duration-1000 ease-out`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: strokeDashoffset,
          }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-3xl font-bold ${colors.text}`}>{percentage}%</span>
        <span className="text-muted-foreground text-xs">satisfied</span>
      </div>
    </div>
  )
}

// Grade colors for visual distinction
const GRADE_COLORS = [
  'bg-amber-500', // dominant (first)
  'bg-sky-400', // second
  'bg-emerald-400', // third
  'bg-violet-400', // fourth
  'bg-rose-400', // fifth+
]

// Fixed display order for "Details by request source" collapsible.
// Iteration order must be stable and independent of per-field totals.
const SOURCE_FIELD_ORDER = [
  'share_bunk_with',
  'do_not_share_with',
  'bunking_notes',
  'internal_notes',
  'socialize_with',
] as const

// Mini segmented grade bar component
function GradeRatioBar({ ratio }: { ratio: NonNullable<ParsedIssue['gradeRatio']> }) {
  // Format grade as ordinal (5 -> 5th, 2 -> 2nd, etc.)
  const ordinal = (n: number): string => {
    const s = ['th', 'st', 'nd', 'rd'] as const
    const v = n % 100
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {/* Segmented progress bar */}
      <div className="bg-muted/30 flex h-2.5 flex-1 overflow-hidden rounded-full">
        {ratio.grades.map((g, i) => {
          const pct = (g.count / ratio.total) * 100
          return (
            <div
              key={g.grade}
              className={`h-full ${GRADE_COLORS[Math.min(i, GRADE_COLORS.length - 1)]} ${i === 0 ? 'rounded-l-full' : ''} ${i === ratio.grades.length - 1 ? 'rounded-r-full' : ''}`}
              style={{ width: `${pct}%` }}
            />
          )
        })}
      </div>
      {/* Grade labels with counts */}
      <div className="flex shrink-0 items-center gap-3">
        {ratio.grades.map((g, i) => (
          <span key={g.grade} className="flex items-center gap-1 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${GRADE_COLORS[Math.min(i, GRADE_COLORS.length - 1)]}`}
            />
            <span
              className={`w-5 text-right font-semibold tabular-nums ${i === 0 ? 'text-foreground' : 'text-foreground/70'}`}
            >
              {g.count}
            </span>
            <span className="text-muted-foreground text-xs">{ordinal(g.grade)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// Single issue item with visual structure
function IssueItem({ issue }: { issue: PostCheckIssue }) {
  const parsed = parseIssueMessage(issue)

  const getBadgeStyles = () => {
    switch (parsed.badgeColor) {
      case 'red':
        return 'bg-red-500/15 text-red-600'
      case 'amber':
        return 'bg-amber-500/15 text-amber-600'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  // Special rendering for grade ratio
  if (parsed.gradeRatio) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-foreground w-12 shrink-0 text-sm font-medium">{parsed.primary}</span>
        <GradeRatioBar ratio={parsed.gradeRatio} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-foreground truncate text-sm font-medium">{parsed.primary}</span>
        {parsed.secondary && (
          <>
            <span className="text-muted-foreground text-xs">→</span>
            <span className="text-foreground/70 truncate text-sm">{parsed.secondary}</span>
          </>
        )}
      </div>
      {parsed.badge && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${getBadgeStyles()}`}
        >
          {parsed.badge}
        </span>
      )}
    </div>
  )
}

// PostCheckIssue group component with expand/collapse
function IssueGroup({
  type,
  issues,
  severity,
}: {
  type: string
  issues: PostCheckIssue[]
  severity: string
}) {
  const [isExpanded, setIsExpanded] = useState(issues.length <= 3)

  const getSeverityStyles = () => {
    switch (severity) {
      case 'error':
        return {
          bg: 'bg-red-500/8',
          border: 'border-red-500/20',
          icon: 'text-red-500',
          badge: 'bg-red-500/15 text-red-600',
        }
      case 'warning':
        return {
          bg: 'bg-amber-500/8',
          border: 'border-amber-500/20',
          icon: 'text-amber-500',
          badge: 'bg-amber-500/15 text-amber-600',
        }
      default:
        return {
          bg: 'bg-forest-500/8',
          border: 'border-forest-500/20',
          icon: 'text-forest-500',
          badge: 'bg-forest-500/15 text-forest-600',
        }
    }
  }

  const styles = getSeverityStyles()
  const severityIcons = {
    error: AlertTriangle,
    warning: AlertCircle,
    info: Activity,
  } as const
  const Icon = severityIcons[severity as keyof typeof severityIcons] ?? Activity

  return (
    <div className={`rounded-xl border ${styles.border} overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex w-full items-center justify-between px-3 py-2.5 ${styles.bg} transition-opacity hover:opacity-80`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${styles.icon}`} />
          <span className="text-foreground text-sm font-medium">{getIssueTypeLabel(type)}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-xs ${styles.badge}`}>
            {issues.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        )}
      </button>

      {isExpanded && (
        <div className={`${styles.bg} border-t ${styles.border} max-h-40 overflow-y-auto`}>
          <div className="divide-border/30 divide-y">
            {issues.map((issue, idx) => (
              <IssueItem key={idx} issue={issue} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type FamilyRow = {
  key: string
  name: string
  cm_id: string
  grade: number
  gender: string
  cohort: 'got_nothing' | 'violated' | 'priority_unmet'
  detail: React.ReactNode
}

export default function PostValidationResultsModal({
  isOpen,
  onClose,
  results,
  scenarioId,
  sessionCmId,
  impossibilityReport,
  preCheckError = false,
  sessionName,
  year,
}: PostValidationResultsModalProps) {
  const { user } = useAuth()
  const plannerName = (user?.['name'] as string | undefined) || 'Camp Staff'
  const [showDetails, setShowDetails] = useState(false)
  const [showUnmetParents, setShowUnmetParents] = useState(false)
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [expandedBunks, setExpandedBunks] = useState<Set<string>>(new Set())
  const toggleBunkExpand = useCallback((bunkName: string) => {
    setExpandedBunks((prev) => {
      const next = new Set(prev)
      if (next.has(bunkName)) {
        next.delete(bunkName)
      } else {
        next.add(bunkName)
      }
      return next
    })
  }, [])
  useEffect(() => {
    if (!isOpen) setSelectedCamperId(null)
  }, [isOpen])

  // Need to compute these even when modal is closed since Modal might render conditionally
  const statistics = results.statistics
  const unmetParents = statistics.unsatisfied_material_parent_persons ?? []
  const unmetParentDetail = statistics.unsatisfied_material_parent_detail ?? []
  // Either bucket (legacy persons array OR detail array) is enough to render
  // the drill-down — backend may emit just one.
  const hasUnmetDrilldown = unmetParents.length > 0 || unmetParentDetail.length > 0
  // Memoize issues to prevent dependency array changes on every render
  const issues = useMemo(() => results.issues, [results.issues])
  const parentTotal = statistics.material_parent_requests ?? 0
  // When parent requests exist, use parent satisfaction as the primary signal;
  // fall back to all-up rate for staff-only sessions without parent requests.
  const satisfactionRate =
    parentTotal > 0
      ? (statistics.material_parent_request_satisfaction_rate ?? 0)
      : statistics.request_satisfaction_rate
  const PARENT_SATISFACTION_TARGET = 0.85
  const parentUnderTarget = parentTotal > 0 && satisfactionRate < PARENT_SATISFACTION_TARGET

  // Residual issues: neither bunk-level nor suppressed (surfaced in dedicated sections).
  const otherIssues = useMemo(
    () =>
      issues.filter(
        (i) => !SUPPRESSED_ISSUE_TYPES.has(i.type) && !BUNK_LEVEL_ISSUE_TYPES.has(i.type)
      ),
    [issues]
  )
  const groupedOtherIssues = useMemo(() => {
    const byType = new Map<string, { issues: PostCheckIssue[]; severity: string }>()
    for (const issue of otherIssues) {
      const existing = byType.get(issue.type)
      if (existing) existing.issues.push(issue)
      else byType.set(issue.type, { issues: [issue], severity: issue.severity })
    }
    return [...byType.entries()]
  }, [otherIssues])

  // Unified "Families to contact" list — combines all three contact-action cohorts:
  // got_nothing (entirely-impossible MP campers), violated (not-bunk-with violations),
  // and priority_unmet (priority-flagged requests that didn't land). Sorted by first name.
  // Sort/filter logic lives in PdfExport/familyRows.ts (shared with PDF export).
  // Modal re-decorates string detail into JSX for richer inline formatting.
  const familyRows: FamilyRow[] = useMemo(() => {
    const safeReport = impossibilityReport ?? {
      mp_campers_entirely_impossible: [],
      flat: [],
      by_reason: {},
      total_impossible: 0,
      affected_campers: 0,
    }
    const baseRows = buildFamilyRows(statistics, safeReport)
    return baseRows.map((r) => {
      let detail: React.ReactNode
      if (r.cohort === 'got_nothing') {
        const c = (safeReport.mp_campers_entirely_impossible ?? []).find(
          (x) => String(x.cm_id) === r.cm_id
        )
        detail = (
          <span>
            All requests impossible · {(c?.reason_codes ?? []).map(friendlyReasonLabel).join(', ')}
          </span>
        )
      } else if (r.cohort === 'violated') {
        const v = (statistics.negative_request_violations_detail ?? []).find(
          (x) => `nv-${x.requester_cm_id}-${x.target_cm_id}-${x.bunk_cm_id}` === r.key
        )
        detail = v ? (
          <span>
            Placed with {v.target_name} in <span className="font-mono text-xs">{v.bunk_name}</span>
          </span>
        ) : (
          <span>{r.detail}</span>
        )
      } else {
        const p = (statistics.priority_unsuccessfuls ?? []).find(
          (x) => `pu-${x.requester_cm_id}-${x.target_cm_id}` === r.key
        )
        detail = p ? (
          <span>
            Wanted {p.target_name} · <em className="text-stone-500">&ldquo;{p.raw_text}&rdquo;</em>
          </span>
        ) : (
          <span>{r.detail}</span>
        )
      }
      return { ...r, detail }
    })
  }, [statistics, impossibilityReport])

  const hasIssues = issues.length > 0
  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  // KPI tile + section counts exclude suppressed types so the headline number
  // matches the sum of what staff actually see below.
  const visibleIssuesCount = issues.filter((i) => !SUPPRESSED_ISSUE_TYPES.has(i.type)).length

  // Bunk-level issues grouped by extracted bunk name (alphabetical).
  const bunkLevelIssues = useMemo(
    () => issues.filter((i) => BUNK_LEVEL_ISSUE_TYPES.has(i.type)),
    [issues]
  )
  const issuesByBunk = useMemo(() => {
    const map = new Map<string, typeof bunkLevelIssues>()
    for (const issue of bunkLevelIssues) {
      const bunk = extractBunkName(issue)
      const arr = map.get(bunk) ?? []
      arr.push(issue)
      map.set(bunk, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [bunkLevelIssues])

  const getOverallStatus = () => {
    let base: {
      label: string
      sublabel: string
      icon: typeof Sparkles
      gradient: string
      iconBg: string
    }
    if (satisfactionRate >= PARENT_SATISFACTION_TARGET && errorCount === 0) {
      base = {
        label: 'Excellent!',
        sublabel: 'Bunking looks great',
        icon: Sparkles,
        gradient: 'from-forest-500/10 to-forest-400/5',
        iconBg: 'bg-forest-500 text-white shadow-lg shadow-forest-500/30',
      }
    } else if (satisfactionRate >= 0.7 && errorCount === 0) {
      base = {
        label: 'Looking Good',
        sublabel: `${Math.round(satisfactionRate * 100)}% requests satisfied`,
        icon: CheckCircle2,
        gradient: 'from-forest-500/10 to-forest-400/5',
        iconBg: 'bg-forest-500 text-white shadow-lg shadow-forest-500/30',
      }
    } else if (satisfactionRate >= 0.5) {
      const parts: string[] = []
      if (familyRows.length > 0)
        parts.push(`${familyRows.length} ${familyRows.length === 1 ? 'family' : 'families'}`)
      if (issuesByBunk.length > 0)
        parts.push(`${issuesByBunk.length} ${issuesByBunk.length === 1 ? 'bunk' : 'bunks'}`)
      const otherCount = groupedOtherIssues.reduce((sum, [, g]) => sum + g.issues.length, 0)
      if (otherCount > 0) parts.push(`${otherCount} other`)
      if (hasUnmetDrilldown && parts.length === 0) parts.push('unmet parent requests')
      const sublabel = parts.length > 0 ? parts.join(' · ') : 'no issues to review'
      base = {
        label: 'Needs Attention',
        sublabel,
        icon: AlertCircle,
        gradient: 'from-amber-500/15 to-amber-400/5',
        iconBg: 'bg-amber-500 text-white shadow-lg shadow-amber-500/30',
      }
    } else {
      base = {
        label: 'Needs Work',
        sublabel: 'Consider re-running the solver',
        icon: AlertTriangle,
        gradient: 'from-red-500/15 to-red-400/5',
        iconBg: 'bg-red-500 text-white shadow-lg shadow-red-500/30',
      }
    }

    const unmetKids = statistics.campers_with_unsatisfied_material_parent_requests ?? 0
    if (unmetKids > 0) {
      base.sublabel = `${unmetKids} kid${unmetKids === 1 ? '' : 's'} missed a parent request`
    } else if (parentTotal > 0) {
      base.sublabel = `All ${parentTotal} parent request${parentTotal === 1 ? '' : 's'} fulfilled`
    }

    return base
  }

  const status = getOverallStatus()
  const StatusIcon = status.icon

  const headerContent = (
    <div className={`flex items-center gap-3 bg-gradient-to-r py-4 pr-14 pl-5 ${status.gradient}`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${status.iconBg}`}>
        <StatusIcon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="font-display text-foreground text-lg leading-tight font-bold">
          {status.label}
        </h2>
        <p className="text-muted-foreground text-sm">
          {status.sublabel}
          {scenarioId && <span className="ml-1 opacity-70">(Draft)</span>}
        </p>
      </div>
    </div>
  )

  const footerContent = (
    <div className="bg-muted/30 border-border/50 flex items-center justify-between border-t px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-xs">
          {new Date(results.validated_at).toLocaleString()}
        </span>
        <LazyPdfExportButton
          sessionName={sessionName ?? String(sessionCmId)}
          year={year ?? new Date().getFullYear()}
          plannerName={plannerName}
          statistics={statistics}
          impossibilityReport={
            impossibilityReport ?? {
              total_impossible: 0,
              affected_campers: 0,
              by_reason: {},
              flat: [],
              mp_campers_entirely_impossible: [],
            }
          }
          issues={results.issues}
          {...(getLogoPath('large') ? { logoUrl: getLogoPath('large')! } : {})}
        />
      </div>
      <button
        onClick={onClose}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
          satisfactionRate >= 0.7 && errorCount === 0
            ? 'bg-forest-500 hover:bg-forest-600 shadow-forest-500/20 text-white shadow-lg'
            : 'bg-muted hover:bg-muted/80 text-foreground'
        }`}
      >
        {satisfactionRate >= 0.7 && errorCount === 0 ? 'Looks Great!' : 'Close'}
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen && !!results}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="md"
      noPadding
      scrollable
    >
      {/* Satisfaction Ring + Quick Stats */}
      <div className="border-border/50 flex items-center gap-6 border-b px-5 py-5">
        {/* Ring */}
        <SatisfactionRing rate={satisfactionRate} size={100} />

        {/* Stats grid */}
        <div className="grid flex-1 grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-forest-500/10 flex h-8 w-8 items-center justify-center rounded-lg">
              <Users className="text-forest-600 h-4 w-4" />
            </div>
            <div>
              <p className="text-foreground text-lg leading-tight font-semibold">
                {statistics.assigned_campers}/{statistics.total_campers}
              </p>
              <p className="text-muted-foreground text-xs">assigned</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                parentUnderTarget ? 'bg-amber-500/10' : 'bg-forest-500/10'
              }`}
            >
              <Heart
                className={`h-4 w-4 ${parentUnderTarget ? 'text-amber-600' : 'text-forest-600'}`}
              />
            </div>
            <div>
              <p className="text-foreground text-lg leading-tight font-semibold">
                {parentTotal > 0
                  ? `${statistics.satisfied_material_parent_requests ?? 0}/${parentTotal}`
                  : `${statistics.satisfied_requests}/${statistics.total_requests}`}
              </p>
              <p className="text-muted-foreground text-xs">
                {parentTotal > 0 ? 'parent requests met' : 'requests met'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-forest-500/10 flex h-8 w-8 items-center justify-center rounded-lg">
              <Home className="text-forest-600 h-4 w-4" />
            </div>
            <div>
              <p className="text-foreground text-lg leading-tight font-semibold">
                {statistics.bunks_at_capacity +
                  statistics.bunks_under_capacity +
                  statistics.bunks_over_capacity}
              </p>
              <p className="text-muted-foreground text-xs">bunks used</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                errorCount > 0
                  ? 'bg-red-500/10'
                  : warningCount > 0
                    ? 'bg-amber-500/10'
                    : 'bg-forest-500/10'
              }`}
            >
              <Target
                className={`h-4 w-4 ${
                  errorCount > 0
                    ? 'text-red-600'
                    : warningCount > 0
                      ? 'text-amber-600'
                      : 'text-forest-600'
                }`}
              />
            </div>
            <div>
              <p className="text-foreground text-lg leading-tight font-semibold">
                {visibleIssuesCount}
              </p>
              <p className="text-muted-foreground text-xs">issues</p>
            </div>
          </div>
        </div>
      </div>

      {/* TG-9: "Families to contact" — unified action list consolidating:
          - Cohort A: entirely-impossible MP campers (got nothing)
          - Cohort B: not-bunk-with violations (families to call)
          - Cohort C: priority-flagged requests that didn't land
          All rows sorted alphabetically by camper first name. */}
      {familyRows.length > 0 && (
        <div className="px-5 pt-4">
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-red-900">Families to contact</h3>
                <p className="mt-0.5 text-xs text-red-800/80">
                  {familyRows.length} follow-up call{familyRows.length === 1 ? '' : 's'} recommended
                </p>
              </div>
              <span className="rounded-full bg-red-200/80 px-2.5 py-1 text-xs font-medium text-red-900">
                {familyRows.length}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-red-100 text-sm">
              {familyRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left font-medium text-stone-900 hover:text-red-700"
                      onClick={() => setSelectedCamperId(row.cm_id)}
                    >
                      {row.name}
                    </button>
                    {row.grade > 0 && (
                      <span className="text-xs text-stone-500">
                        {' '}
                        · {row.grade}
                        {['th', 'st', 'nd', 'rd'][((row.grade % 100) - 20) % 10] ||
                          ['th', 'st', 'nd', 'rd'][row.grade % 100] ||
                          'th'}{' '}
                        · {row.gender}
                      </span>
                    )}
                    <div className="text-xs text-stone-600">{row.detail}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.cohort === 'got_nothing'
                        ? 'bg-red-100 text-red-800'
                        : row.cohort === 'violated'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-pink-100 text-pink-800'
                    }`}
                  >
                    {row.cohort === 'got_nothing'
                      ? 'Got nothing'
                      : row.cohort === 'violated'
                        ? 'Not-bunk-with violated'
                        : 'Priority unmet'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {preCheckError && !impossibilityReport && (
        <div className="px-5 py-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            Pre-check unavailable — couldn&rsquo;t load the impossibility cohort. Re-run Pre-Check
            to see it.
          </div>
        </div>
      )}

      {/* TG-4.6: "Impossible by reason" — by_reason breakdown from pre-check.
          Shows as collapsible stat tiles in post-check's card visual language. */}
      {impossibilityReport && Object.keys(impossibilityReport.by_reason).length > 0 && (
        <div className="px-5 pt-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <h3 className="text-sm font-semibold text-stone-900">Impossible by reason</h3>
            <p className="mt-0.5 text-xs text-stone-500">
              Summary only — see Pre-Check or export PDF for full per-camper detail
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(impossibilityReport.by_reason).map(([code, items]) => (
                <li key={code} className="flex flex-col rounded-lg bg-white px-3 py-2 text-center">
                  <span className="text-foreground text-lg font-bold">{items.length}</span>
                  <span className="text-muted-foreground text-xs">{friendlyReasonLabel(code)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Capacity by gender */}
      {statistics.capacity_by_gender && (
        <div className="px-5 pt-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-stone-900">Capacity by gender</h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  Bunk fill compared to enrolled camper count
                </p>
              </div>
            </div>
            <div className="mt-2">
              {Object.entries(statistics.capacity_by_gender ?? {}).map(([g, cap]) => {
                const pct = cap.capacity > 0 ? Math.round((cap.assigned / cap.capacity) * 100) : 0
                const barColor =
                  cap.assigned > cap.capacity
                    ? 'bg-red-500'
                    : pct >= 90
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                return (
                  <div key={g} className="flex items-center gap-2 py-1.5">
                    <span className="w-14 text-xs font-medium text-stone-700 capitalize">{g}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-stone-200">
                      <div
                        className={`h-full ${barColor}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="min-w-[80px] text-right text-xs text-stone-600">
                      {cap.assigned} / {cap.capacity}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bunks needing attention */}
      {issuesByBunk.length > 0 && (
        <div className="px-5 pt-3">
          <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-orange-900">Bunks needing attention</h3>
                <p className="mt-0.5 text-xs text-orange-800/80">
                  {issuesByBunk.length} bunk{issuesByBunk.length === 1 ? '' : 's'} have warnings
                </p>
              </div>
              <span className="rounded-full bg-orange-200/80 px-2.5 py-1 text-xs font-medium text-orange-900">
                {issuesByBunk.length}
              </span>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {issuesByBunk.map(([bunkName, bunkIssues]) => {
                const isExpanded = expandedBunks.has(bunkName)
                return (
                  <li key={bunkName} className="rounded-lg bg-white px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 text-left"
                      onClick={() => toggleBunkExpand(bunkName)}
                      aria-expanded={isExpanded}
                    >
                      <span className="font-medium text-stone-900">{bunkName}</span>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                      )}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {bunkIssues.map((iss, idx) => (
                        <span
                          key={idx}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            iss.type === 'capacity_violation'
                              ? 'bg-red-200 text-red-900'
                              : 'bg-amber-200 text-amber-900'
                          }`}
                        >
                          {getIssueTypeLabel(iss.type)}
                        </span>
                      ))}
                    </div>
                    {isExpanded && (
                      <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2">
                        {bunkIssues.map((iss, idx) => (
                          <li key={idx} className="text-xs text-stone-600">
                            {formatBunkIssueDetail(iss)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Other issues — residual types not covered by Families to contact or Bunks needing attention */}
      {groupedOtherIssues.length > 0 && (
        <div className="px-5 pt-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-stone-900">Other issues</h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  Items not covered by Families to contact or Bunks needing attention
                </p>
              </div>
              <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700">
                {groupedOtherIssues.reduce((sum, [, g]) => sum + g.issues.length, 0)}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {groupedOtherIssues.map(([type, group]) => (
                <IssueGroup
                  key={type}
                  type={type}
                  issues={group.issues}
                  severity={group.severity}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Success state message */}
      {issues.length === 0 && (
        <div className="px-5 py-6 text-center">
          <div className="bg-forest-500/10 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Sparkles className="text-forest-500 h-6 w-6" />
          </div>
          <p className="text-muted-foreground text-sm">
            No issues detected. All bunking assignments look great!
          </p>
        </div>
      )}

      {/* Unmet parent requests drill-down (#1105) */}
      {hasUnmetDrilldown && (
        <div className="border-border/50 border-t">
          <button
            type="button"
            onClick={() => setShowUnmetParents(!showUnmetParents)}
            aria-expanded={showUnmetParents}
            aria-controls="unmet-parent-requests-list"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/30 flex w-full items-center justify-between px-5 py-3 text-sm transition-colors"
          >
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {/* Detail path counts REQUESTS; legacy persons path counts unique
                  CAMPERS — disambiguate the label so the noun matches the number. */}
              {unmetParentDetail.length > 0
                ? `Unmet parent requests (${unmetParentDetail.length})`
                : `Campers with unmet parent requests (${unmetParents.length})`}
            </span>
            {showUnmetParents ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showUnmetParents && (
            <ul
              id="unmet-parent-requests-list"
              className="animate-fade-in max-h-48 space-y-1 overflow-y-auto px-5 pb-4"
            >
              {(() => {
                const detail = statistics.unsatisfied_material_parent_detail ?? []
                // When detail isn't available, fall back to plain names so older sessions still render.
                const rows =
                  detail.length > 0
                    ? [...detail].sort((a, b) => a.requester_name.localeCompare(b.requester_name))
                    : unmetParents.map((p) => ({
                        requester_cm_id: String(p.cm_id),
                        requester_name: p.name,
                        target_cm_id: '',
                        target_name: '',
                        requester_bunk_name: '',
                        target_bunk_name: '',
                      }))
                return rows.map((r) => (
                  <li
                    key={`${r.requester_cm_id}-${r.target_cm_id}`}
                    className="text-foreground py-1 text-sm"
                  >
                    <span className="font-medium">{r.requester_name}</span>
                    {r.target_name && (
                      <>
                        <span className="text-stone-500"> wanted </span>
                        <span className="font-medium">{r.target_name}</span>
                      </>
                    )}
                    {r.requester_bunk_name && r.target_bunk_name && (
                      <span className="text-xs text-stone-500">
                        {' '}
                        · <span className="font-mono">{r.requester_bunk_name}</span> vs{' '}
                        <span className="font-mono">{r.target_bunk_name}</span>
                      </span>
                    )}
                  </li>
                ))
              })()}
            </ul>
          )}
        </div>
      )}

      {/* Collapsible Details */}
      {Object.keys(statistics.field_stats).length > 0 && (
        <div className="border-border/50 border-t">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/30 flex w-full items-center justify-between px-5 py-3 text-sm transition-colors"
          >
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Details by request source
            </span>
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showDetails && (
            <div className="animate-fade-in space-y-2 px-5 pb-4">
              {SOURCE_FIELD_ORDER.map((fieldName) => {
                const stats = statistics.field_stats[fieldName]
                if (!stats) return null
                return (
                  <div
                    key={fieldName}
                    className="bg-muted/40 flex items-center justify-between rounded-xl p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-foreground text-sm font-medium">
                        {formatSourceField(fieldName)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {stats.satisfied}/{stats.total}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        stats.satisfaction_rate >= 0.8
                          ? 'bg-forest-500/15 text-forest-600'
                          : stats.satisfaction_rate >= 0.5
                            ? 'bg-amber-500/15 text-amber-600'
                            : 'bg-red-500/15 text-red-600'
                      }`}
                    >
                      {Math.round(stats.satisfaction_rate * 100)}%
                    </span>
                  </div>
                )
              })}

              {/* Capacity info */}
              {statistics.bunks_over_capacity > 0 && (
                <div className="text-muted-foreground mt-3 rounded-lg border border-amber-500/10 bg-amber-500/5 p-2 text-xs">
                  <span className="font-medium text-amber-600">Note:</span>{' '}
                  {statistics.bunks_over_capacity} bunk
                  {statistics.bunks_over_capacity > 1 ? 's are' : ' is'} over capacity
                </div>
              )}

              {statistics.unassigned_campers > 0 && (
                <div className="text-muted-foreground rounded-lg border border-red-500/10 bg-red-500/5 p-2 text-xs">
                  <span className="font-medium text-red-600">Note:</span>{' '}
                  {statistics.unassigned_campers} camper
                  {statistics.unassigned_campers > 1 ? 's need' : ' needs'} bunk assignment
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* CamperDetailsPanel calls useBunkRequestContext() unconditionally;
          SessionHeader (where the Check-Bunking button lives) sits outside
          SessionView's BunkRequestProvider tree, so we mount a local
          session-scoped provider here. The provider mount is hoisted above
          the selectedCamperId gate so opening/closing the details panel
          doesn't churn the provider's observers. Tradeoff: this fires the
          provider's two queries (allBunkRequests + /api/satisfaction) on
          every modal open even if the user never clicks a camper name —
          both queries are cache-warm in the common case (session header
          already populated them). ErrorBoundary catches chunk-load failures. */}
      <BunkRequestProvider sessionCmId={sessionCmId}>
        {selectedCamperId && (
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="fixed inset-y-0 right-0 z-50 m-4 max-w-md rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                <p>Couldn&apos;t load camper details: {error.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    reset()
                    setSelectedCamperId(null)
                  }}
                  className="mt-2 rounded bg-red-600 px-3 py-1 text-white"
                >
                  Close
                </button>
              </div>
            )}
          >
            <Suspense fallback={null}>
              <LazyCamperDetailsPanel
                camperId={selectedCamperId}
                onClose={() => setSelectedCamperId(null)}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </BunkRequestProvider>
    </Modal>
  )
}
