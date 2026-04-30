import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { UNIT_NAMES, getUnitForBunk } from '../../../utils/unitMapping'
import type { BunkSummary } from '../graphFilter'

interface GraphFilterComboboxProps {
  selectedUnits: string[]
  selectedBunkIds: number[]
  allBunks: BunkSummary[]
  onAddUnit: (unit: string) => void
  onRemoveUnit: (unit: string) => void
  onAddBunk: (bunkCmId: number) => void
  onRemoveBunk: (bunkCmId: number) => void
}

type Row =
  | { kind: 'unit'; name: string }
  | { kind: 'bunk'; cmId: number; name: string; unit: string | null }

export default function GraphFilterCombobox({
  selectedUnits,
  selectedBunkIds,
  allBunks,
  onAddUnit,
  onRemoveUnit,
  onAddBunk,
  onRemoveBunk,
}: GraphFilterComboboxProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const allRows: Row[] = useMemo(() => {
    const unitRows: Row[] = UNIT_NAMES.map((u) => ({ kind: 'unit', name: u }))
    const bunkRows: Row[] = allBunks.map((b) => ({
      kind: 'bunk',
      cmId: b.cmId,
      name: b.name,
      unit: getUnitForBunk(b.name),
    }))
    return [...unitRows, ...bunkRows]
  }, [allBunks])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allRows.filter((row) => {
      if (row.kind === 'unit' && selectedUnits.includes(row.name)) return false
      if (row.kind === 'bunk' && selectedBunkIds.includes(row.cmId)) return false
      if (!q) return true
      if (row.kind === 'unit') return row.name.toLowerCase().includes(q)
      return row.name.toLowerCase().includes(q) || (row.unit?.toLowerCase().includes(q) ?? false)
    })
  }, [allRows, query, selectedUnits, selectedBunkIds])

  const selectRow = (row: Row) => {
    if (row.kind === 'unit') onAddUnit(row.name)
    else onAddBunk(row.cmId)
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, visibleRows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      const row = visibleRows[highlight]
      if (row) {
        e.preventDefault()
        selectRow(row)
      }
    } else if (e.key === 'Backspace' && query === '') {
      const lastBunk = selectedBunkIds.at(-1)
      const lastUnit = selectedUnits.at(-1)
      if (lastBunk != null) onRemoveBunk(lastBunk)
      else if (lastUnit) onRemoveUnit(lastUnit)
    } else if (e.key === 'Escape') {
      setQuery('')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="border-border flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-200">
        {selectedUnits.map((u) => (
          <span
            key={`u-${u}`}
            className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800"
          >
            {u}
            <button
              type="button"
              aria-label={`Remove ${u}`}
              onClick={() => onRemoveUnit(u)}
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {selectedBunkIds.map((id) => {
          const bunk = allBunks.find((b) => b.cmId === id)
          return (
            <span
              key={`b-${id}`}
              className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800"
            >
              {bunk?.name ?? `#${id}`}
              <button
                type="button"
                aria-label={`Remove ${bunk?.name ?? id}`}
                onClick={() => onRemoveBunk(id)}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={true}
          aria-controls="filter-listbox"
          aria-activedescendant={visibleRows.length > 0 ? `row-${highlight}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKey}
          placeholder={
            selectedUnits.length + selectedBunkIds.length === 0 ? 'Add a unit or bunk…' : ''
          }
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ul
        id="filter-listbox"
        role="listbox"
        className="border-border max-h-56 overflow-y-auto rounded-lg border"
      >
        {visibleRows.length === 0 && (
          <li className="text-muted-foreground px-3 py-2 text-sm italic">No matches</li>
        )}
        {visibleRows.map((row, i) => (
          <li
            id={`row-${i}`}
            role="option"
            key={row.kind === 'unit' ? `u-${row.name}` : `b-${row.cmId}`}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => selectRow(row)}
            className={clsx(
              'cursor-pointer px-3 py-1.5 text-sm',
              i === highlight && 'bg-muted',
              row.kind === 'unit' ? 'font-semibold' : 'text-muted-foreground pl-7'
            )}
          >
            <span className="inline-flex w-full items-center justify-between">
              <span>
                {row.kind === 'unit' ? (
                  <>
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full bg-purple-500 align-middle"
                      aria-hidden="true"
                    />
                    {row.name}
                  </>
                ) : (
                  row.name
                )}
              </span>
              {row.kind === 'bunk' && row.unit && (
                <span className="text-xs text-gray-400" aria-hidden="true">
                  {row.unit}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
