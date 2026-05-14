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
  UserMinus,
} from 'lucide-react'
import { Modal } from './ui/Modal'
import type {
  ImpossibilityReport,
  ImpossibilityReportItem,
  ImpossibilityCluster,
} from '../services/solver'
import { usePermissions } from '../hooks/usePermissions'

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

// Friendly labels for impossibility reason codes (staff view)
const FRIENDLY_REASON_LABELS: Record<string, string> = {
  grade_compatibility: 'Grade range too wide',
  cluster_grade_compatibility: 'Group spans too many grades',
  cross_session: 'Different sessions',
  pair_no_shared_bunk: "Can't share a cabin (no compatible cabin available)",
  age_pref_no_eligible_grade: 'No matching age group available',
  cluster_capacity: 'Group too large for one cabin',
  malformed: 'Incomplete request',
  target_not_in_session: 'Requested camper not in this session',
}

function friendlyReasonLabel(code: string): string {
  return FRIENDLY_REASON_LABELS[code] || code
}

function ordinalGrade(grade: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = grade % 100
  return `${grade}${s[(v - 20) % 10] || s[v] || s[0]} grade`
}

const TECHNICAL_REASON_DESCRIPTIONS: Record<string, string> = {
  grade_compatibility: 'pair_grade_gap > max_range',
  cluster_grade_compatibility: 'component grade span > max_range',
  cross_session: 'requester.session ≠ requestee.session',
  pair_no_shared_bunk: 'no bunk satisfies gender + grade for both campers',
  age_pref_no_eligible_grade: 'age_preference grade-bound outside pool grades',
  cluster_capacity: 'component_size > max_bunk_capacity',
  malformed: 'missing requestee_id or invalid request_type',
  target_not_in_session: 'requestee_id not in solver input',
}

function technicalReasonDescription(code: string): string {
  return TECHNICAL_REASON_DESCRIPTIONS[code] || code
}

function shortenReqId(id: string): string {
  if (id.length <= 11) return id
  return `${id.slice(0, 8)}…`
}

function compactPerson(p: { name: string; cm_id: number; grade: number; gender: string }): string {
  return `${p.name} (${p.cm_id}/g${p.grade}/${p.gender})`
}

function compactDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ')
}

function AdminReasonTable({ items }: { items: ImpossibilityReportItem[] }) {
  return (
    <table className="mt-2 w-full border-collapse font-mono text-xs">
      <thead>
        <tr className="border-b border-amber-200 text-left text-stone-500">
          <th className="px-1 py-1 font-normal">req_id</th>
          <th className="px-1 py-1 font-normal">requester</th>
          <th className="px-1 py-1 font-normal">requestee</th>
          <th className="px-1 py-1 font-normal">type</th>
          <th className="px-1 py-1 font-normal">detail</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.request_id} className="border-b border-amber-100/60">
            <td className="px-1 py-1 text-stone-500">{shortenReqId(item.request_id)}</td>
            <td className="px-1 py-1">{compactPerson(item.requester)}</td>
            <td className="px-1 py-1">{item.requestee ? compactPerson(item.requestee) : '—'}</td>
            <td className="px-1 py-1 text-stone-600">{item.request_type}</td>
            <td className="px-1 py-1 text-stone-600">{compactDetail(item.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type ViewMode = 'by-reason' | 'flat' | 'json'

function ImpossibilityItems({
  items,
  mode = 'staff',
}: {
  items: ImpossibilityReportItem[]
  mode?: 'staff' | 'admin'
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-amber-200 pt-2">
      {items.map((item) => (
        <div key={item.request_id} className="text-sm">
          <div className="font-medium">
            {item.requester.name} · {ordinalGrade(item.requester.grade)}
            {mode === 'admin' && (
              <span className="ml-2 font-mono text-xs text-stone-500">
                cm_id={item.requester.cm_id} · {item.requester.gender}
              </span>
            )}
          </div>
          {item.requestee && (
            <div className="text-stone-600">
              wants to bunk with <strong>{item.requestee.name}</strong> ·{' '}
              {ordinalGrade(item.requestee.grade)}
              {mode === 'admin' && (
                <span className="ml-2 font-mono text-xs text-stone-500">
                  cm_id={item.requestee.cm_id} · {item.requestee.gender}
                </span>
              )}
            </div>
          )}
          {mode === 'admin' && (
            <div className="mt-2 rounded bg-stone-100 p-2 font-mono text-xs">
              <div className="text-stone-500">{item.reason_code}</div>
              {Object.entries(item.detail ?? {}).map(([k, v]) => (
                <div key={k}>
                  {k}={String(v)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ClusterCard({
  cluster,
  mode,
}: {
  cluster: ImpossibilityCluster
  mode: 'staff' | 'admin'
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="font-semibold text-amber-900">{friendlyReasonLabel(cluster.reason_code)}</div>
      <div className="mt-1 text-sm text-stone-700">{cluster.reason_message}</div>
      {cluster.campers.length > 0 && (
        <div className="mt-2 space-y-0.5 text-sm">
          {cluster.campers.map((c) => (
            <div key={c.cm_id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{c.name}</span>
              <span className="text-stone-600">· {ordinalGrade(c.grade)}</span>
              {mode === 'admin' && (
                <span className="font-mono text-xs text-stone-500">
                  cm_id={c.cm_id} · {c.gender}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {mode === 'admin' && (
        <div className="mt-2 rounded bg-stone-100 p-2 font-mono text-xs">
          <div className="text-stone-500">{cluster.reason_code}</div>
          {Object.entries(cluster.detail ?? {}).map(([k, v]) => (
            <div key={k}>
              {k}={String(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type FlatTableSortColumn = 'name' | 'cm_id' | 'grade' | 'gender' | 'reason'
type FlatTableSortDir = 'asc' | 'desc'

function FlatTable({ items }: { items: ImpossibilityReportItem[] }) {
  const [sortCol, setSortCol] = useState<FlatTableSortColumn>('name')
  const [sortDir, setSortDir] = useState<FlatTableSortDir>('asc')

  const sortedItems = useMemo(() => {
    const arr = [...items]
    arr.sort((a, b) => {
      let av: string | number
      let bv: string | number
      switch (sortCol) {
        case 'name':
          av = a.requester.name
          bv = b.requester.name
          break
        case 'cm_id':
          av = a.requester.cm_id
          bv = b.requester.cm_id
          break
        case 'grade':
          av = a.requester.grade
          bv = b.requester.grade
          break
        case 'gender':
          av = a.requester.gender
          bv = b.requester.gender
          break
        case 'reason':
          av = a.reason_code
          bv = b.reason_code
          break
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [items, sortCol, sortDir])

  const handleSort = (col: FlatTableSortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const arrow = (col: FlatTableSortColumn) =>
    sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const headerCell = (col: FlatTableSortColumn, label: string) => (
    <th
      scope="col"
      onClick={() => handleSort(col)}
      className="cursor-pointer border-b border-stone-300 px-2 py-1 text-left font-semibold select-none hover:bg-stone-200"
    >
      {label}
      {arrow(col)}
    </th>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-stone-100">
          <tr>
            {headerCell('name', 'Name')}
            {headerCell('cm_id', 'CM ID')}
            {headerCell('grade', 'Grade')}
            {headerCell('gender', 'Gender')}
            {headerCell('reason', 'Reason')}
            <th scope="col" className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => (
            <tr key={item.request_id} className="border-b border-stone-200">
              <td className="px-2 py-1">{item.requester.name}</td>
              <td className="px-2 py-1 font-mono">{item.requester.cm_id}</td>
              <td className="px-2 py-1">{item.requester.grade}</td>
              <td className="px-2 py-1">{item.requester.gender}</td>
              <td className="px-2 py-1 font-mono">{item.reason_code}</td>
              <td className="px-2 py-1 font-mono text-stone-600">
                {Object.entries(item.detail ?? {})
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JsonView({ report }: { report: ImpossibilityReport }) {
  return (
    <pre
      data-testid="impossibility-json"
      className="max-h-96 overflow-auto rounded bg-stone-100 p-3 font-mono text-xs"
    >
      {JSON.stringify(report, null, 2)}
    </pre>
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
  const { isAdmin } = usePermissions()
  const [viewMode, setViewMode] = useState<ViewMode>('by-reason')

  const { valid, errors, warnings, statistics, impossibility_report } = results

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
      size={isAdmin ? 'xl' : 'lg'}
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

      {/* Impossibility Report */}
      <div className="space-y-3 px-5 py-4">
        {isAdmin &&
          (impossibility_report.total_impossible > 0 ||
            impossibility_report.clusters.length > 0) && (
            <div role="tablist" className="mb-2 flex gap-1 border-b border-stone-200">
              {(['by-reason', 'flat', 'json'] as const).map((tab) => {
                const label =
                  tab === 'by-reason' ? 'By reason' : tab === 'flat' ? 'Flat table' : 'JSON'
                const active = viewMode === tab
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewMode(tab)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'border-forest-500 text-forest-700 font-medium'
                        : 'border-transparent text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

        {impossibility_report.total_impossible === 0 &&
        impossibility_report.clusters.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="mr-2 inline-block h-5 w-5" />
            No impossible requests found for this scenario.
          </div>
        ) : isAdmin && viewMode === 'flat' ? (
          <FlatTable items={impossibility_report.flat} />
        ) : isAdmin && viewMode === 'json' ? (
          <JsonView report={impossibility_report} />
        ) : (
          <>
            {Object.entries(impossibility_report.by_reason).map(([code, items]) =>
              isAdmin ? (
                <details
                  key={code}
                  open
                  className="rounded-md border border-amber-200 bg-amber-50 p-3 font-mono"
                >
                  <summary className="flex cursor-pointer items-center justify-between font-semibold text-amber-900">
                    <span>{code}</span>
                    <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-white">
                      {items.length}
                    </span>
                  </summary>
                  <div className="mt-1 text-[11px] text-stone-600">
                    {technicalReasonDescription(code)}
                  </div>
                  <AdminReasonTable items={items} />
                </details>
              ) : (
                <details
                  key={code}
                  open
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between font-semibold text-amber-900">
                    <span>{friendlyReasonLabel(code)}</span>
                    <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-white">
                      {items.length}
                    </span>
                  </summary>
                  <ImpossibilityItems items={items} mode="staff" />
                </details>
              )
            )}

            {impossibility_report.clusters.map((cluster, idx) => (
              <ClusterCard key={idx} cluster={cluster} mode={isAdmin ? 'admin' : 'staff'} />
            ))}
          </>
        )}
      </div>

      {/* Collapsible Details */}
      {(impossibility_report.total_impossible > 0 ||
        impossibility_report.clusters.length > 0 ||
        hasIssues) && (
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
