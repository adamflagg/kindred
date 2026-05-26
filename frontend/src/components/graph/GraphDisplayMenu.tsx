import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

export interface GraphDisplayMenuProps {
  showBubbles: boolean
  onToggleBubbles: (next: boolean) => void
  showUnits: boolean
  onToggleUnits: (next: boolean) => void
  crossScope: boolean
  onToggleCrossScope: (next: boolean) => void
}

export default function GraphDisplayMenu({
  showBubbles,
  onToggleBubbles,
  showUnits,
  onToggleUnits,
  crossScope,
  onToggleCrossScope,
}: GraphDisplayMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-muted hover:bg-muted/80 flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm transition-colors sm:py-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">Display</span>
      </button>
      {open && (
        <div
          role="menu"
          className="border-border bg-card shadow-lodge-md absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border p-2"
        >
          <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={showBubbles}
              onChange={(e) => onToggleBubbles(e.target.checked)}
            />
            Bunk bubbles
          </label>
          <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={showUnits}
              onChange={(e) => onToggleUnits(e.target.checked)}
            />
            Unit grouping
          </label>
          <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={crossScope}
              onChange={(e) => onToggleCrossScope(e.target.checked)}
            />
            Show cross-scope edges
          </label>
        </div>
      )}
    </div>
  )
}
