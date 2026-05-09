import { useEffect, useRef, useState } from 'react'

import type { SolverRunsFilters } from '../../../utils/queryKeys'

import {
  ALL_COLUMNS,
  ALL_COLUMNS_KEYS,
  COMPACT_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
} from './solverColumns'

export interface SolverFiltersBarSession {
  cm_id: number
  session_name: string
  year?: number
}

interface SolverFiltersBarProps {
  filters: SolverRunsFilters
  onFiltersChange: (next: SolverRunsFilters) => void
  visibleColumns: string[]
  onColumnsChange: (next: string[]) => void
  /**
   * Real session list — cm_ids match `solver_runs.session_id`. Without this,
   * the filter dropdown can't resolve to actual run rows.
   */
  sessions: SolverFiltersBarSession[]
}

export function SolverFiltersBar({
  filters,
  onFiltersChange,
  visibleColumns,
  onColumnsChange,
  sessions,
}: SolverFiltersBarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const pickerWrapperRef = useRef<HTMLDivElement | null>(null)
  const groups = Array.from(new Set(ALL_COLUMNS.map((c) => c.group)))

  useEffect(() => {
    if (!showPicker) return
    const handleMouseDown = (e: MouseEvent) => {
      const wrapper = pickerWrapperRef.current
      if (wrapper && e.target instanceof Node && !wrapper.contains(e.target)) {
        setShowPicker(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPicker(false)
    }
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showPicker])

  const toggleColumn = (key: string) =>
    onColumnsChange(
      visibleColumns.includes(key)
        ? visibleColumns.filter((k) => k !== key)
        : [...visibleColumns, key]
    )

  return (
    <div className="relative mb-4 flex items-center gap-3 text-sm">
      <select
        aria-label="Filter by session"
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5"
        value={filters.sessionId ?? ''}
        onChange={(e) => {
          const next: SolverRunsFilters = { ...filters }
          if (e.target.value) {
            next.sessionId = Number(e.target.value)
          } else {
            delete next.sessionId
          }
          onFiltersChange(next)
        }}
      >
        <option value="">All sessions</option>
        {sessions.map((s) => (
          <option key={s.cm_id} value={s.cm_id}>
            {s.session_name}
            {s.year ? ` — ${s.year}` : ''}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-gray-600">
        <input
          type="checkbox"
          checked={filters.hideFailed ?? false}
          onChange={(e) => onFiltersChange({ ...filters, hideFailed: e.target.checked })}
        />
        Hide failed
      </label>
      <div ref={pickerWrapperRef} className="relative ml-auto flex items-center gap-2">
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:text-gray-900"
        >
          ⚙ Columns ({visibleColumns.length}/{ALL_COLUMNS.length})
        </button>
        {showPicker ? (
          <div className="absolute top-[calc(100%+6px)] right-0 z-20 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="mb-2 text-xs font-semibold">Configure columns</div>
            <div className="mb-3 flex gap-1.5">
              <button
                onClick={() => onColumnsChange(COMPACT_COLUMNS)}
                className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
              >
                Compact
              </button>
              <button
                onClick={() => onColumnsChange(DEFAULT_VISIBLE_COLUMNS)}
                className="bg-forest-500 rounded px-2 py-1 text-xs text-white"
              >
                Default
              </button>
              <button
                onClick={() => onColumnsChange(ALL_COLUMNS_KEYS)}
                className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
              >
                All
              </button>
            </div>
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    {group}
                  </div>
                  {ALL_COLUMNS.filter((c) => c.group === group).map((c) => (
                    <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(c.key)}
                        onChange={() => toggleColumn(c.key)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
