import type { CSSProperties } from 'react'

export const PHASE_COLORS: Record<string, string> = {
  priority: 'hsl(270, 60%, 55%)',
  early: 'hsl(200, 70%, 50%)',
  open: 'hsl(140, 60%, 40%)',
}

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
