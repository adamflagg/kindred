import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import type { ImpossibilityReport, ImpossibilityReportItem } from '../services/solver'

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

function compactPerson(p: { name: string; cm_id: number; grade: number; gender: string }): string {
  return `${p.name} (${p.cm_id}/g${p.grade}/${p.gender})`
}

function compactDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ')
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

  const sorted = useMemo(() => {
    const arr = [...report.flat]
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
  }, [report.flat, sortCol, sortDir])

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortCol(col)
      setSortDir('asc')
    }
  }
  const arrow = (col: SortColumn) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setJustCopied(true)
    setTimeout(() => setJustCopied(false), 1500)
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
    <Modal isOpen={isOpen} onClose={onClose} header={headerContent} size="xl" scrollable noPadding>
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
                      {c.name} ({c.cm_id}/g{c.grade}/{c.gender})
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
          <table className="w-full border-collapse text-xs">
            <thead className="bg-stone-100">
              <tr>
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
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: chip.bg, color: chip.text }}
                      >
                        {item.reason_code}
                      </span>
                    </td>
                    <td className="px-2 py-1">{compactPerson(item.requester)}</td>
                    <td className="px-2 py-1">
                      {item.requestee ? compactPerson(item.requestee) : '—'}
                    </td>
                    <td className="px-2 py-1 text-stone-600">{item.request_type}</td>
                    <td className="px-2 py-1 text-stone-600">{compactDetail(item.detail)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}
