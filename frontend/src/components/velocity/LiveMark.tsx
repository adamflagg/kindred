/**
 * PR 5b (#3207): the SVG pieces of the live point, shared by Velocity's chart and Today's Pace card.
 * The stored (3 a.m.) point is solid, the live point hollow (#108), and the words sit beside the live
 * point (liveLabelLines). Colour comes from the inks, so dark mode follows.
 */
import { DELTA_INK } from '../../utils/deltaTokens'
import type { LiveLabelLine } from './velocityLive'

const TONE_CLASS: Record<LiveLabelLine['tone'], string> = {
  strong: 'text-foreground',
  good: DELTA_INK.good,
  bad: DELTA_INK.bad,
  ink: 'text-muted-foreground',
}

/** The live point's words, one line under another from `y` (the first line's baseline). */
export function LiveLabelText({
  x,
  y,
  anchor,
  fontSize,
  lines,
}: {
  x: number
  y: number
  anchor: 'start' | 'end'
  fontSize: number
  lines: readonly LiveLabelLine[]
}) {
  return (
    <>
      {lines.map((line, i) => (
        <text
          key={line.text}
          data-live-label
          x={x}
          y={y + i * (fontSize + 3)}
          textAnchor={anchor}
          fontSize={fontSize}
          fontWeight={line.weight}
          fill="currentColor"
          className={TONE_CLASS[line.tone]}
        >
          {line.text}
        </text>
      ))}
    </>
  )
}

/** Pace's two points: solid for the stored one, hollow (card-filled) for the live one. */
export function LiveDots({
  stored,
  live,
  r,
  fillClass,
  strokeClass,
}: {
  stored: { x: number; y: number }
  live: { x: number; y: number }
  r: number
  /** The line's colour as a fill class (the stored dot)… */
  fillClass: string
  /** …and as a stroke class (the live dot's ring). */
  strokeClass: string
}) {
  return (
    <>
      <circle data-live-dot="stored" cx={stored.x} cy={stored.y} r={r} className={fillClass} />
      <circle
        data-live-dot="live"
        cx={live.x}
        cy={live.y}
        r={r}
        fill="var(--color-card)"
        strokeWidth={2}
        className={strokeClass}
      />
    </>
  )
}
