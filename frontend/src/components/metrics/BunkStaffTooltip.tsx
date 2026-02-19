/**
 * BunkCellTooltip - Portal-based tooltip for heatmap cells.
 *
 * Shows retention stats (returned/base count) and optionally staff
 * assigned to the bunk. Rendered via createPortal to document.body
 * to avoid clipping from overflow-x-auto on the heatmap table container.
 */
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { BunkStaffInfo } from '../../hooks/useBunkStaff'

interface RetentionInfo {
  returnedCount: number
  baseCount: number
  rate: number
}

interface BunkCellTooltipProps {
  bunkName: string
  retention: RetentionInfo
  staff?: BunkStaffInfo[] | undefined
  isVisible: boolean
  position: { x: number; y: number }
}

export function BunkCellTooltip({
  bunkName,
  retention,
  staff,
  isVisible,
  position,
}: BunkCellTooltipProps) {
  const tooltipPosition = useMemo(() => {
    if (!isVisible || position.x <= 0 || position.y <= 0) {
      return { top: 0, left: 0 }
    }

    const tooltipWidth = 220
    const tooltipHeight = 120
    const padding = 10

    let left = position.x
    let top = position.y

    if (left + tooltipWidth > window.innerWidth) {
      left = position.x - tooltipWidth - padding
    }

    if (top + tooltipHeight > window.innerHeight) {
      top = Math.max(padding, position.y - tooltipHeight - padding)
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding))
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding))

    return { top, left }
  }, [position.x, position.y, isVisible])

  if (!isVisible) return null

  const pct = Math.round(retention.rate * 100)

  return createPortal(
    <div
      data-tooltip="bunk-cell"
      className="bg-popover pointer-events-none fixed z-[100] max-w-[260px] min-w-[180px] rounded-lg border p-3 shadow-lg"
      style={{
        position: 'fixed',
        top: `${tooltipPosition.top}px`,
        left: `${tooltipPosition.left}px`,
      }}
    >
      <h4 className="text-foreground mb-1 text-sm font-semibold">{bunkName}</h4>
      <p className="text-muted-foreground text-xs">
        {retention.returnedCount} of {retention.baseCount} returned ({pct}%)
      </p>
      {staff && staff.length > 0 && (
        <>
          <hr className="border-border my-1.5" />
          <p className="text-muted-foreground mb-0.5 text-[10px] font-medium tracking-wide uppercase">
            Staff
          </p>
          <ul className="space-y-0.5">
            {staff.map((s) => (
              <li key={s.personId} className="text-muted-foreground text-xs">
                {s.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>,
    document.body
  )
}
