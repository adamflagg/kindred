/**
 * PR 5b (#3207): Velocity's live point as a recharts ReferenceDot `shape`: the hollow dot and its words
 * (LiveMark holds the SVG pieces shared with Pace). Recharts hands the point's pixel position in.
 */
import type { ReactElement } from 'react'
import { LiveLabelText } from './LiveMark'
import type { LiveLabelLine } from './velocityLive'

export function velocityLiveDot({
  color,
  lines,
  anchor,
}: {
  color: string
  lines: readonly LiveLabelLine[]
  anchor: 'start' | 'end'
}) {
  return function LiveDot(props: { cx?: number; cy?: number }): ReactElement<SVGElement> {
    const { cx, cy } = props
    if (cx == null || cy == null) return <g />
    return (
      <g>
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
