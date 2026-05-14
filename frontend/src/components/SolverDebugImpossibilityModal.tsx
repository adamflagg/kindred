import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import type {
  ImpossibilityReport,
  ImpossibilityReportItem,
  ImpossibilityCluster,
} from '../services/solver'

type ViewMode = 'by-reason' | 'flat' | 'json'

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

function ByReasonTable({ items }: { items: ImpossibilityReportItem[] }) {
  return (
    <table className="mt-2 w-full border-collapse text-xs">
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

function ClusterEntry({ cluster }: { cluster: ImpossibilityCluster }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center justify-between font-semibold text-amber-900">
        <span>{cluster.reason_code}</span>
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-white">
          {cluster.cm_ids.length}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-stone-600">
        {technicalReasonDescription(cluster.reason_code)}
      </div>
      <div className="mt-2 space-y-0.5 text-xs">
        {cluster.campers.map((c) => (
          <div key={c.cm_id}>{compactPerson(c)}</div>
        ))}
      </div>
      {Object.keys(cluster.detail ?? {}).length > 0 && (
        <div className="mt-2 text-[11px] text-stone-600">{compactDetail(cluster.detail)}</div>
      )}
    </div>
  )
}

type FlatSortColumn = 'name' | 'cm_id' | 'grade' | 'gender' | 'reason'
type FlatSortDir = 'asc' | 'desc'

function FlatTable({ items }: { items: ImpossibilityReportItem[] }) {
  const [sortCol, setSortCol] = useState<FlatSortColumn>('name')
  const [sortDir, setSortDir] = useState<FlatSortDir>('asc')

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

  const handleSort = (col: FlatSortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const arrow = (col: FlatSortColumn) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  const headerCell = (col: FlatSortColumn, label: string) => (
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
              <td className="px-2 py-1">{item.requester.cm_id}</td>
              <td className="px-2 py-1">{item.requester.grade}</td>
              <td className="px-2 py-1">{item.requester.gender}</td>
              <td className="px-2 py-1">{item.reason_code}</td>
              <td className="px-2 py-1 text-stone-600">{compactDetail(item.detail)}</td>
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
      className="max-h-[60vh] overflow-auto rounded bg-stone-100 p-3 text-xs"
    >
      {JSON.stringify(report, null, 2)}
    </pre>
  )
}

interface SolverDebugImpossibilityModalProps {
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
}: SolverDebugImpossibilityModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('by-reason')

  const headerContent = (
    <div className="border-border/50 bg-muted/30 flex items-center justify-between border-b px-5 py-3 font-mono">
      <div>
        <div className="text-foreground text-sm font-bold">
          Pre-validate · session={sessionCmId ?? '—'} year={year}
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          impossibility_report: total={report.total_impossible}, affected_cms=
          {report.affected_campers}, clusters={report.clusters.length}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="text-muted-foreground hover:text-foreground cursor-pointer text-lg"
      >
        ×
      </button>
    </div>
  )

  const empty = report.total_impossible === 0 && report.clusters.length === 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} header={headerContent} size="xl" scrollable noPadding>
      <div className="space-y-3 px-5 py-4 font-mono">
        {!empty && (
          <div role="tablist" className="flex gap-1 border-b border-stone-200">
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
                  className={`-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-xs transition-colors ${
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

        {empty ? (
          <div className="rounded-md bg-green-50 p-3 text-xs text-green-800">
            // impossibility_report empty — no issues detected
          </div>
        ) : viewMode === 'flat' ? (
          <FlatTable items={report.flat} />
        ) : viewMode === 'json' ? (
          <JsonView report={report} />
        ) : (
          <>
            {Object.entries(report.by_reason).map(([code, items]) => (
              <details
                key={code}
                open
                className="rounded-md border border-amber-200 bg-amber-50 p-3"
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
                <ByReasonTable items={items} />
              </details>
            ))}

            {report.clusters.map((cluster, idx) => (
              <ClusterEntry key={idx} cluster={cluster} />
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
