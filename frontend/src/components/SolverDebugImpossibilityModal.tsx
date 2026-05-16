import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './ui/Modal'
import { CamperNameButton } from './impossibility/CamperNameButton'
import { LazyCamperDetailsPanel } from './impossibility/LazyCamperDetailsPanel'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'
import { ErrorBoundary } from './ErrorBoundary'
import type { ImpossibilityReport, ImpossibilityReportItem } from '../services/solver'

type Bucket = 'material_parent' | 'immaterial_parent' | 'staff'
type FilterState = 'all' | Bucket

const FILTER_STORAGE_KEY = 'solver-debug.impossibility-modal-filter'
const BUCKET_ORDER: readonly Bucket[] = ['material_parent', 'immaterial_parent', 'staff'] as const
const BUCKET_LABELS: Record<Bucket, string> = {
  material_parent: 'Material Parent',
  immaterial_parent: 'Immaterial Parent',
  staff: 'Staff',
}
const BUCKET_SHORT: Record<Bucket, string> = {
  material_parent: 'MP',
  immaterial_parent: 'IMP',
  staff: 'Staff',
}

function isBucket(value: unknown): value is Bucket {
  return value === 'material_parent' || value === 'immaterial_parent' || value === 'staff'
}

function loadFilter(): FilterState {
  // localStorage can throw in Safari private mode, quota-exceeded, or storage-disabled
  // contexts (matches the best-effort pattern in src/utils/scenarioStorage.ts).
  try {
    const v = localStorage.getItem(FILTER_STORAGE_KEY)
    if (v === 'all' || isBucket(v)) return v
  } catch {
    // ignore — fall through to default
  }
  return 'all'
}

function useFilter(): [
  FilterState,
  (next: FilterState | ((cur: FilterState) => FilterState)) => void,
  FilterState,
] {
  const [state, setState] = useState<FilterState>(() => loadFilter())
  const [initialState] = useState<FilterState>(() => state)
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, state)
    } catch {
      // Persistence is best-effort; ignore SecurityError / QuotaExceededError.
    }
  }, [state])
  return [state, setState, initialState]
}

function chipClass(active: boolean): string {
  return active
    ? 'rounded-full border border-stone-900 bg-stone-900 px-3 py-0.5 text-xs font-medium text-white'
    : 'rounded-full border border-stone-300 bg-white px-3 py-0.5 text-xs font-medium text-stone-400'
}

interface GroupedRequest {
  request_id: string
  requester: ImpossibilityReportItem['requester']
  requestee: ImpossibilityReportItem['requestee']
  request_type: string
  bucket: Bucket | null
  reasons: ImpossibilityReportItem[]
}

interface GroupedReport {
  byBucket: Record<Bucket, GroupedRequest[]>
  unbucketed: GroupedRequest[]
}

function groupByBucketAndRequest(flat: ImpossibilityReportItem[]): GroupedReport {
  const byRequestId = new Map<string, GroupedRequest>()
  for (const item of flat) {
    const existing = byRequestId.get(item.request_id)
    if (existing) {
      existing.reasons.push(item)
    } else {
      byRequestId.set(item.request_id, {
        request_id: item.request_id,
        requester: item.requester,
        requestee: item.requestee,
        request_type: item.request_type,
        bucket: isBucket(item.bucket) ? item.bucket : null,
        reasons: [item],
      })
    }
  }
  // Sort reasons alphabetically by reason_code within each group
  for (const g of byRequestId.values()) {
    g.reasons.sort((a, b) =>
      a.reason_code < b.reason_code ? -1 : a.reason_code > b.reason_code ? 1 : 0
    )
  }

  const byBucket: Record<Bucket, GroupedRequest[]> = {
    material_parent: [],
    immaterial_parent: [],
    staff: [],
  }
  const unbucketed: GroupedRequest[] = []
  for (const g of byRequestId.values()) {
    if (g.bucket === null) {
      unbucketed.push(g)
    } else {
      byBucket[g.bucket].push(g)
    }
  }
  // Sort each bucket's requests alphabetically by Camper A name
  for (const b of BUCKET_ORDER) {
    byBucket[b].sort((a, b2) => a.requester.name.localeCompare(b2.requester.name))
  }
  unbucketed.sort((a, b) => a.requester.name.localeCompare(b.requester.name))

  return { byBucket, unbucketed }
}

const REASON_CHIP_STYLES: Record<string, { bg: string; text: string }> = {
  grade_compatibility: { bg: '#fef3c7', text: '#92400e' },
  age_pref_no_eligible_grade: { bg: '#fef3c7', text: '#92400e' },
  malformed: { bg: '#fef3c7', text: '#92400e' },
  cross_session: { bg: '#fee2e2', text: '#991b1b' },
  pair_no_shared_bunk: { bg: '#fee2e2', text: '#991b1b' },
  target_not_in_solver: { bg: '#fee2e2', text: '#991b1b' },
}

function ReasonChip({ code }: { code: string }) {
  const style = REASON_CHIP_STYLES[code] ?? { bg: '#f5f5f4', text: '#57534e' }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: style.bg, color: style.text }}
    >
      {code}
    </span>
  )
}

function compactDetail(detail: Record<string, unknown> | null | undefined): ReactNode {
  if (!detail || Object.keys(detail).length === 0) return null
  const parts = Object.entries(detail).map(([k, v], i) => {
    const display = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    return (
      <span key={k}>
        {i > 0 ? ', ' : ''}
        <span className="text-amber-700">{k}</span>=
        <span className="text-stone-900">{display}</span>
      </span>
    )
  })
  return <span className="font-mono text-[10.5px]">{parts}</span>
}

function PairCell({
  requester,
  requestee,
  onSelect,
}: {
  requester: ImpossibilityReportItem['requester']
  requestee: ImpossibilityReportItem['requestee']
  onSelect: (id: string) => void
}) {
  return (
    <span className="whitespace-nowrap">
      <CamperNameButton cmId={requester.cm_id} name={requester.name} onSelect={onSelect} />
      <span className="ml-0.5 text-[10px] text-stone-500">
        ({requester.cm_id}/g{requester.grade}/{requester.gender})
      </span>
      {requestee ? (
        <>
          {' ↔ '}
          <CamperNameButton cmId={requestee.cm_id} name={requestee.name} onSelect={onSelect} />
          <span className="ml-0.5 text-[10px] text-stone-500">
            ({requestee.cm_id}/g{requestee.grade}/{requestee.gender})
          </span>
        </>
      ) : (
        <span className="ml-1 text-stone-400">— —</span>
      )}
    </span>
  )
}

interface Props {
  isOpen: boolean
  onClose: () => void
  report: ImpossibilityReport
  sessionCmId: number | null
  year: number
}

export default function SolverDebugImpossibilityModal({
  isOpen,
  onClose,
  report,
  sessionCmId,
  year,
}: Props) {
  const [filter, setFilter, initialFilter] = useFilter()
  const [justCopied, setJustCopied] = useState(false)
  // Inherited from #1464: clicking any camper name opens CamperDetailsPanel
  // inside a session-scoped BunkRequestProvider. Null = no panel open.
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)

  // Clear the camper selection when the modal closes or the session unsets,
  // so reopening the modal doesn't surface a stale panel.
  useEffect(() => {
    if (!isOpen || sessionCmId === null) setSelectedCamperId(null)
  }, [isOpen, sessionCmId])

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setJustCopied(true)
    setTimeout(() => setJustCopied(false), 1500)
  }

  const grouped = useMemo(() => groupByBucketAndRequest(report.flat), [report.flat])

  const visibleBuckets: readonly Bucket[] = filter === 'all' ? BUCKET_ORDER : ([filter] as const)

  const handleChipClick = (b: Bucket) => {
    setFilter((cur) => {
      if (cur === 'all') return b
      if (cur === b) return 'all'
      return b
    })
  }

  const allActive = filter === 'all'

  // Snapshot the initial loaded state once for the "from last open" indicator.
  // initialFilter is captured at mount via useState's initializer — never re-reads localStorage.
  const stateDifferedAtLoad = initialFilter !== 'all'

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

  // Camper-details panel — rendered alongside the modal, mirrors #1464's pattern
  // (PreValidationResultsModal). BunkRequestProvider > ErrorBoundary > Suspense >
  // LazyCamperDetailsPanel — ErrorBoundary catches chunk-load failures so a thrown
  // panel doesn't crash the whole modal.
  const camperPanel =
    selectedCamperId != null && sessionCmId != null ? (
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
    ) : null

  if (report.total_impossible === 0) {
    return (
      <>
        <Modal
          isOpen={isOpen}
          onClose={onClose}
          header={headerContent}
          size="2xl"
          scrollable
          noPadding
        >
          <div className="px-5 py-4 font-mono">
            <div className="rounded-md bg-green-50 p-3 text-xs text-green-800">
              // impossibility_report empty — no issues detected
            </div>
          </div>
        </Modal>
        {camperPanel}
      </>
    )
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        header={headerContent}
        size="2xl"
        scrollable
        noPadding
      >
        <div>
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
            <button type="button" onClick={() => setFilter('all')} className={chipClass(allActive)}>
              All <span className="ml-1 opacity-65">{report.total_impossible}</span>
            </button>
            <span className="text-stone-300">|</span>
            {BUCKET_ORDER.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => handleChipClick(b)}
                className={chipClass(allActive || filter === b)}
              >
                {BUCKET_SHORT[b]}{' '}
                <span className="ml-1 opacity-65">{report.by_bucket_count[b] ?? 0}</span>
              </button>
            ))}
            {stateDifferedAtLoad ? (
              <span className="ml-auto text-[10px] text-stone-400">↻ from last open</span>
            ) : null}
          </div>

          {/*
            Hoisted stuck-block: when the MP section isn't rendered (filter isolated to
            IMP/Staff, or MP has no requests), surface the entirely-impossible MP campers
            above the bucket sections so the 🛑 rollup is never filter-gated. When the MP
            section IS rendered, the in-section block carries this content — we don't
            duplicate.
          */}
          {(() => {
            const stuckCampers = report.mp_campers_entirely_impossible ?? []
            const mpSectionWillRender =
              (filter === 'all' || filter === 'material_parent') &&
              grouped.byBucket.material_parent.length > 0
            if (stuckCampers.length === 0 || mpSectionWillRender) return null
            return (
              <div
                data-testid="mp-stuck-block-hoisted"
                className="border-t border-red-200 bg-red-50 px-5 py-2 font-mono text-[10.5px]"
              >
                <div className="mb-1 text-[10px] font-bold tracking-wider text-red-900 uppercase">
                  🛑 MP · {stuckCampers.length} entirely-impossible
                </div>
                {stuckCampers.map((c) => (
                  <div key={c.cm_id} className="flex flex-wrap items-center gap-1.5 py-0.5">
                    <span className="font-semibold text-red-900">
                      <CamperNameButton
                        cmId={c.cm_id}
                        name={c.name}
                        onSelect={setSelectedCamperId}
                      />
                      <span className="ml-1 text-[10px] font-normal text-stone-400">
                        ({c.cm_id}/g{c.grade}/{c.gender})
                      </span>
                    </span>
                    {[...new Set(c.reason_codes)].sort().map((code) => (
                      <ReasonChip key={code} code={code} />
                    ))}
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Bucket sections */}
          {visibleBuckets.map((b) => {
            const requests = grouped.byBucket[b] ?? []
            if (requests.length === 0) return null

            const stuckCmIds = new Set(
              (report.mp_campers_entirely_impossible ?? []).map((c) => c.cm_id)
            )
            const isStuckRequest = (g: GroupedRequest): boolean =>
              b === 'material_parent' && stuckCmIds.has(g.requester.cm_id)

            // Pin stuck rows to top of MP section; preserve alphabetical within each partition.
            const sortedRequests =
              b === 'material_parent'
                ? [
                    ...requests.filter(isStuckRequest),
                    ...requests.filter((g) => !isStuckRequest(g)),
                  ]
                : requests

            const showStuckBlock =
              b === 'material_parent' && (report.mp_campers_entirely_impossible?.length ?? 0) > 0

            return (
              <section key={b} aria-label={BUCKET_LABELS[b]} className="border-t border-stone-300">
                <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-5 py-2 font-sans text-[10px] font-bold tracking-wider text-stone-700 uppercase">
                  <span>
                    {BUCKET_SHORT[b]} · {BUCKET_LABELS[b]} ·{' '}
                    <span className="font-medium tracking-normal text-stone-500 normal-case">
                      {requests.length} impossible
                    </span>
                  </span>
                  {showStuckBlock ? (
                    <span className="ml-auto font-bold tracking-normal text-red-900 normal-case">
                      🛑 {report.mp_campers_entirely_impossible!.length} entirely-impossible
                    </span>
                  ) : null}
                </div>

                {showStuckBlock ? (
                  <div
                    data-testid="mp-stuck-block"
                    className="border-b border-red-200 bg-red-50 px-5 py-2 font-mono text-[10.5px]"
                  >
                    {report.mp_campers_entirely_impossible!.map((c) => (
                      <div key={c.cm_id} className="flex flex-wrap items-center gap-1.5 py-0.5">
                        <span className="font-semibold text-red-900">
                          <CamperNameButton
                            cmId={c.cm_id}
                            name={c.name}
                            onSelect={setSelectedCamperId}
                          />
                          <span className="ml-1 text-[10px] font-normal text-stone-400">
                            ({c.cm_id}/g{c.grade}/{c.gender})
                          </span>
                        </span>
                        {[...new Set(c.reason_codes)].sort().map((code) => (
                          <ReasonChip key={code} code={code} />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}

                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {sortedRequests.map((g) => {
                      const stuck = isStuckRequest(g)
                      return (
                        <tr
                          key={g.request_id}
                          className={`border-b border-stone-100 last:border-b-0 ${stuck ? 'bg-red-50' : ''}`}
                        >
                          <td className="w-[38%] px-5 py-1.5 align-top">
                            {stuck ? <span className="mr-1">🛑</span> : null}
                            <PairCell
                              requester={g.requester}
                              requestee={g.requestee}
                              onSelect={setSelectedCamperId}
                            />
                          </td>
                          <td className="px-5 py-1.5 align-top">
                            {g.reasons.map((r) => (
                              <div key={r.reason_code} className="mb-0.5 last:mb-0">
                                <ReasonChip code={r.reason_code} />
                                <span className="ml-1.5">{compactDetail(r.detail)}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )
          })}

          {/* Unbucketed fallback: items with bucket=null, only shown in "all" view */}
          {filter === 'all' && grouped.unbucketed.length > 0 ? (
            <section aria-label="Unbucketed" className="border-t border-stone-300">
              <div className="border-b border-stone-200 bg-stone-50 px-5 py-2 font-sans text-[10px] font-bold tracking-wider text-stone-700 uppercase">
                Unbucketed ·{' '}
                <span className="font-medium tracking-normal text-stone-500 normal-case">
                  {grouped.unbucketed.length} impossible — source_field missing or unknown
                </span>
              </div>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {grouped.unbucketed.map((g) => (
                    <tr key={g.request_id} className="border-b border-stone-100 last:border-b-0">
                      <td className="w-[38%] px-5 py-1.5 align-top">
                        <PairCell
                          requester={g.requester}
                          requestee={g.requestee}
                          onSelect={setSelectedCamperId}
                        />
                      </td>
                      <td className="px-5 py-1.5 align-top">
                        {g.reasons.map((r) => (
                          <div key={r.reason_code} className="mb-0.5 last:mb-0">
                            <ReasonChip code={r.reason_code} />
                            <span className="ml-1.5">{compactDetail(r.detail)}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {/* Edge case: isolated to a bucket with zero items */}
          {!allActive && (grouped.byBucket[filter as Bucket] ?? []).length === 0 ? (
            <div className="px-5 py-4 text-xs text-stone-500">
              No impossibilities in this bucket — click All to see everything.
            </div>
          ) : null}
        </div>
      </Modal>
      {camperPanel}
    </>
  )
}
