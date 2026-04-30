import { useEffect, useRef } from 'react'
import GraphFilterCombobox from './GraphFilterCombobox'
import type { BunkSummary, FilterEdgeMode } from '../graphFilter'

interface GraphFilterPopoverProps {
  open: boolean
  onClose: () => void
  selectedUnits: string[]
  selectedBunkIds: number[]
  allBunks: BunkSummary[]
  edgeMode: FilterEdgeMode
  onAddUnit: (unit: string) => void
  onRemoveUnit: (unit: string) => void
  onAddBunk: (cmId: number) => void
  onRemoveBunk: (cmId: number) => void
  onSetEdgeMode: (mode: FilterEdgeMode) => void
  onClear: () => void
}

export default function GraphFilterPopover({
  open,
  onClose,
  selectedUnits,
  selectedBunkIds,
  allBunks,
  edgeMode,
  onAddUnit,
  onRemoveUnit,
  onAddBunk,
  onRemoveBunk,
  onSetEdgeMode,
  onClear,
}: GraphFilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [open, onClose])

  if (!open) return null

  const isFilterActive = selectedUnits.length > 0 || selectedBunkIds.length > 0

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Graph filter"
      className="bg-card border-border motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 absolute top-full right-0 z-30 mt-2 w-80 origin-top-right rounded-xl border p-3 shadow-lg motion-safe:duration-150"
    >
      <GraphFilterCombobox
        selectedUnits={selectedUnits}
        selectedBunkIds={selectedBunkIds}
        allBunks={allBunks}
        onAddUnit={onAddUnit}
        onRemoveUnit={onRemoveUnit}
        onAddBunk={onAddBunk}
        onRemoveBunk={onRemoveBunk}
      />
      <div className="border-border mt-3 flex items-center justify-between border-t pt-3 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={edgeMode === 'cross-scope'}
            onChange={(e) => onSetEdgeMode(e.target.checked ? 'cross-scope' : 'strict')}
            className="rounded"
          />
          <span className="text-muted-foreground">Show cross-scope edges</span>
        </label>
        {isFilterActive && (
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  )
}
