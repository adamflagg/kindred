/**
 * PR 5b (#3207): Velocity's recharts `dot` for the live segment (LiveMark holds the shared SVG pieces).
 */
import type { ReactElement } from 'react'
import { LiveLabelText } from './LiveMark'
import type { LiveLabelLine } from './velocityLive'

/**
 * Velocity's recharts `dot` for the two-point live line: index 0 is the stored point (solid), index 1 the
 * live point (hollow) with its words. Recharts hands each point's pixel position in.
 */
export function velocityLiveDot({
  color,
  lines,
  anchor,
}: {
  color: string
  lines: readonly LiveLabelLine[]
  anchor: 'start' | 'end'
}) {
  return function LiveDot(props: { cx?: number; cy?: number; index?: number }): ReactElement {
    const { cx, cy, index } = props
    if (cx == null || cy == null) return <g key={`live-${String(index)}`} />
    if (index === 0) {
      return <circle key="live-stored" data-live-dot="stored" cx={cx} cy={cy} r={4} fill={color} />
    }
    return (
      <g key="live-now">
        <circle
          data-live-dot="live"
          cx={cx}
          cy={cy}
          r={4.5}
          fill="var(--color-card)"
          stroke={color}
          strokeWidth={2}
        />
        <LiveLabelText
          x={anchor === 'start' ? cx + 9 : cx - 9}
          y={cy - 8}
          anchor={anchor}
          fontSize={12}
          lines={lines}
        />
      </g>
    )
  }
}
