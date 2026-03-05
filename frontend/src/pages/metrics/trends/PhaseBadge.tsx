import type { CSSProperties } from 'react'
import { PHASE_COLORS } from './phaseColors'

export function PhaseBadge({ phase, label }: { phase: string; label: string }) {
  const color = PHASE_COLORS[phase]
  if (!color) return null

  const shortLabel = label.replace(/ Registration$/, '')
  const style: CSSProperties = {
    backgroundColor: color.replace('hsl(', 'hsla(').replace(')', ', 0.15)'),
    color,
  }

  return (
    <span className="ml-1.5 rounded px-1 py-0.5 text-xs font-medium" style={style}>
      {shortLabel}
    </span>
  )
}
