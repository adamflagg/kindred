import { Suspense, useEffect, useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import type { ImpossibilityReport, ImpossibilityReportItem } from '../services/solver'
import { CamperNameButton } from './impossibility/CamperNameButton'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'

import { LazyCamperDetailsPanel } from './impossibility/LazyCamperDetailsPanel'
import { ErrorBoundary } from './ErrorBoundary'

type Bucket = 'material_parent' | 'immaterial_parent' | 'staff'
type BucketFilter = 'all' | Bucket

const BUCKET_ORDER: readonly Bucket[] = ['material_parent', 'immaterial_parent', 'staff'] as const

// Filter-chip labels (mixed case for natural reading in the chip row).
const BUCKET_CHIP_LABEL: Record<Bucket, string> = {
  material_parent: 'MP',
  immaterial_parent: 'IMP',
  staff: 'Staff',
}

// In-row bucket chip — all-caps to match the visual weight of reason chips.
const BUCKET_ROW_LABEL: Record<Bucket, string> = {
  material_parent: 'MP',
  immaterial_parent: 'IMP',
  staff: 'STAFF',
}

const BUCKET_CHIP_STYLE: Record<Bucket, { bg: string; text: string }> = {
  material_parent: { bg: '#dbeafe', text: '#1e3a8a' },
  immaterial_parent: { bg: '#ede9fe', text: '#5b21b6' },
  staff: { bg: '#f1f5f9', text: '#475569' },
}

const FILTER_STORAGE_KEY = 'solver-debug.impossibility-modal-filter'

const REASON_CHIP_STYLES: Record<string, { bg: string; text: string }> = {
  grade_compatibility: { bg: '#fef3c7', text: '#92400e' },
  age_pref_no_eligible_grade: { bg: '#fef3c7', text: '#92400e' },
  malformed: { bg: '#fef3c7', text: '#92400e' },
  cross_session: { bg: '#fee2e2', text: '#991b1b' },
  pair_no_shared_bunk: { bg: '#fee2e2', text: '#991b1b' },
  target_not_in_solver: { bg: '#fee2e2', text: '#991b1b' },
}

function reasonChipStyle(code: string) {
  return REASON_CHIP_STYLES[code] ?? { bg: '#f5f5f4', text: '#57534e' }
}

function compactDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ')
}

function isBucket(v: unknown): v is Bucket {
  return v === 'material_parent' || v === 'immaterial_parent' || v === 'staff'
}

function isBucketFilter(v: unknown): v is BucketFilter {
  return v === 'all' || isBucket(v)
}

function loadInitialFilter(): BucketFilter {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (isBucketFilter(raw)) return raw
  } catch {
    // localStorage may throw in restricted contexts; fall through to default
  }
  return 'all'
}

function persistFilter(filter: BucketFilter): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, filter)
  } catch {
    // best-effort persistence
  }
}

type SortColumn = 'reason' | 'name' | 'type'
type SortDir = 'asc' | 'desc'

interface Props {
  isOpen: boolean
  onClose: () => void
  report: ImpossibilityReport
  sessionCmId: number | null
  year: number
}

function SortableHeader({
  column,
  label,
  sortCol,
  sortDir,
  onSort,
  arrow,
}: {
  column: SortColumn
  label: string
  sortCol: SortColumn
  sortDir: SortDir
  onSort: (col: SortColumn) => void
  arrow: (col: SortColumn) => string
}) {
  const ariaSort: 'ascending' | 'descending' | 'none' =
    sortCol === column ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      aria-sort={ariaSort}
      className="border-b border-stone-300 px-2 py-1 text-left font-semibold"
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Sort by ${label.toLowerCase()}`}
        onClick={() => onSort(column)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSort(column)
          }
        }}
        className="-mx-2 -my-1 inline-block w-full cursor-pointer px-2 py-1 hover:bg-stone-200 focus:bg-stone-200 focus:outline-none"
      >
        {label}
        {arrow(column)}
      </span>
    </th>
  )
}

function BucketChip({ bucket }: { bucket: Bucket }) {
  const style = BUCKET_CHIP_STYLE[bucket]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: style.bg, color: style.text }}
    >
      {BUCKET_ROW_LABEL[bucket]}
    </span>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-stone-900 bg-stone-900 px-3 py-0.5 font-sans text-xs font-medium text-white'
          : 'rounded-full border border-stone-300 bg-white px-3 py-0.5 font-sans text-xs font-medium text-stone-700 hover:bg-stone-50'
      }
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-65">{count}</span>
    </button>
  )
}

export default function SolverDebugImpossibilityModal({
  isOpen,
  onClose,
  report,
  sessionCmId,
  year,
}: Props) {
  const [sortCol, setSortCol] = useState<SortColumn>('reason')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [justCopied, setJustCopied] = useState(false)
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>(loadInitialFilter)

  // SolverDebugPage gates this modal on preCheckQuery.data (stable), so the
  // component stays mounted across isOpen toggles. Clear the selection on
  // close — and when the session is unset — so a reopened modal doesn't
  // pop the panel back over the user's next view.
  useEffect(() => {
    if (!isOpen || sessionCmId === null) setSelectedCamperId(null)
  }, [isOpen, sessionCmId])

  useEffect(() => {
    persistFilter(bucketFilter)
  }, [bucketFilter])

  const handleBucketChipClick = (bucket: Bucket) => {
    // Click an inactive bucket → isolate to it. Click the already-isolated
    // bucket → toggle back to all. Click "All" while isolated → reset to all.
    setBucketFilter((prev) => (prev === bucket ? 'all' : bucket))
  }

  const sorted = useMemo(() => {
    const arr = report.flat.filter((item) => bucketFilter === 'all' || item.bucket === bucketFilter)
    arr.sort((a, b) => {
      const get = (item: ImpossibilityReportItem): string | number => {
        switch (sortCol) {
          case 'reason':
            return item.reason_code
          case 'name':
            return item.requester.name
          case 'type':
            return item.request_type
        }
      }
      const av = get(a)
      const bv = get(b)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [report.flat, sortCol, sortDir, bucketFilter])

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortCol(col)
      setSortDir('asc')
    }
  }
  const arrow = (col: SortColumn) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  const handleCopyJson = async () => {
    // Copy the full unfiltered report — the filter is a view, not a slice.
    const text = JSON.stringify(report, null, 2)
    // navigator.clipboard requires a secure context (HTTPS or localhost). When
    // a worktree is opened over LAN HTTP (http://<host>:<vite-port>), the
    // clipboard API is undefined or throws, so fall back to the legacy
    // execCommand path. Both are best-effort.
    let copied = false
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {
        // fall through to execCommand
      }
    }
    if (!copied && typeof document !== 'undefined') {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try {
        copied = document.execCommand('copy')
      } catch {
        copied = false
      } finally {
        document.body.removeChild(ta)
      }
    }
    if (copied) {
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 1500)
    }
  }

  const headerContent = (
    <div className="border-border/50 flex items-center justify-between border-b px-5 py-3 font-mono">
      <div>
        <div className="text-foreground text-sm font-bold">
          Pre-validate · session={sessionCmId ?? '—'} · year={year}
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {report.total_impossible} impossible requests · {report.affected_campers} campers affected
        </div>
      </div>
      <div className="mr-12 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCopyJson}
          className="rounded border border-stone-300 bg-white px-2.5 py-1 font-sans text-xs hover:bg-stone-50"
        >
          {justCopied ? '✓ Copied' : '📋 Copy JSON'}
        </button>
      </div>
    </div>
  )

  const empty = report.total_impossible === 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} header={headerContent} size="2xl" scrollable noPadding>
      <div className="px-5 py-4 font-mono">
        {report.mp_campers_entirely_impossible &&
          report.mp_campers_entirely_impossible.length > 0 && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3">
              <div className="text-xs font-bold text-red-900">
                {`${report.mp_campers_entirely_impossible.length} entirely-impossible MP campers — zero parent requests honored`}
              </div>
              <div className="mt-2 space-y-1">
                {report.mp_campers_entirely_impossible.map((c) => (
                  <div key={c.cm_id} className="flex items-center gap-2 text-xs">
                    <span className="text-stone-700">
                      <CamperNameButton
                        cmId={c.cm_id}
                        name={c.name}
                        onSelect={setSelectedCamperId}
                        disabled={sessionCmId === null}
                      />{' '}
                      ({c.cm_id}/g{c.grade}/{c.gender})
                    </span>
                    {c.reason_codes.map((code) => {
                      const chip = reasonChipStyle(code)
                      return (
                        <span
                          key={code}
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: chip.bg, color: chip.text }}
                        >
                          {code}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        {empty ? (
          <div className="rounded-md bg-green-50 p-3 text-xs text-green-800">
            // impossibility_report empty — no issues detected
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <FilterChip
                label="All"
                count={report.total_impossible}
                active={bucketFilter === 'all'}
                onClick={() => setBucketFilter('all')}
              />
              {BUCKET_ORDER.map((b) => (
                <FilterChip
                  key={b}
                  label={BUCKET_CHIP_LABEL[b]}
                  count={report.by_bucket_count?.[b] ?? 0}
                  active={bucketFilter === b}
                  onClick={() => handleBucketChipClick(b)}
                />
              ))}
            </div>
            <table className="w-full border-collapse text-xs">
              {/* Column widths: Detail is the long column (k=v lists) so cap
                  Bucket/Reason/Camper A/Camper B/Type and let Detail breathe.
                  whitespace-nowrap on Detail keeps "k=v, k=v, k=v" on one
                  line so admins can scan without word wraps mid-key. */}
              <colgroup>
                <col style={{ width: '4rem' }} />
                <col style={{ width: '11.5rem' }} />
                <col style={{ width: '12.5rem' }} />
                <col style={{ width: '12.5rem' }} />
                <col style={{ width: '7.5rem' }} />
                <col />
              </colgroup>
              <thead className="bg-stone-100">
                <tr>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Bucket
                  </th>
                  <SortableHeader
                    column="reason"
                    label="Reason"
                    sortCol={sortCol}
                    sortDir={sortDir}
                    onSort={handleSort}
                    arrow={arrow}
                  />
                  <SortableHeader
                    column="name"
                    label="Camper A"
                    sortCol={sortCol}
                    sortDir={sortDir}
                    onSort={handleSort}
                    arrow={arrow}
                  />
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Camper B
                  </th>
                  <SortableHeader
                    column="type"
                    label="Type"
                    sortCol={sortCol}
                    sortDir={sortDir}
                    onSort={handleSort}
                    arrow={arrow}
                  />
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item: ImpossibilityReportItem) => {
                  const chip = reasonChipStyle(item.reason_code)
                  // Composite key — multi-reason recording in validate_impossibility
                  // can produce multiple flat items per request_id (one per matching
                  // predicate). request_id + reason_code is unique per item.
                  return (
                    <tr
                      key={`${item.request_id}-${item.reason_code}`}
                      className="border-b border-stone-200"
                    >
                      <td className="px-2 py-1">
                        {isBucket(item.bucket) ? (
                          <BucketChip bucket={item.bucket} />
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: chip.bg, color: chip.text }}
                        >
                          {item.reason_code}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <CamperNameButton
                          cmId={item.requester.cm_id}
                          name={item.requester.name}
                          onSelect={setSelectedCamperId}
                          disabled={sessionCmId === null}
                        />{' '}
                        <span className="text-stone-500">
                          ({item.requester.cm_id}/g{item.requester.grade}/{item.requester.gender})
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        {item.requestee ? (
                          <>
                            <CamperNameButton
                              cmId={item.requestee.cm_id}
                              name={item.requestee.name}
                              onSelect={setSelectedCamperId}
                              disabled={sessionCmId === null}
                            />{' '}
                            <span className="text-stone-500">
                              ({item.requestee.cm_id}/g{item.requestee.grade}/
                              {item.requestee.gender})
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-1 text-stone-600">{item.request_type}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-stone-600">
                        {compactDetail(item.detail)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      {selectedCamperId != null && sessionCmId != null && (
        // CamperDetailsPanel calls useBunkRequestContext() unconditionally;
        // SolverDebugPage has no ancestor BunkRequestProvider, so we mount a
        // local session-scoped one here. Provider stays gated behind the
        // selectedCamperId check so the provider's queries don't fire on
        // every modal open (matches PR #1469's tighter gate vs main).
        <BunkRequestProvider sessionCmId={sessionCmId}>
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
        </BunkRequestProvider>
      )}
    </Modal>
  )
}
