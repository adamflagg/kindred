import type { ApiAidWeekPoint } from '../../../types/api-types'
import { CS_EMPTY } from './csType'
import { campToday, parseIsoDay } from './dates'
import { formatMoneyCompact, formatMoneyScale } from './money'

const W = 300
const H = 150
const PAD = { left: 38, right: 8, top: 12, bottom: 20 }
const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FONT = 10.5 // the mock's chart type (audit F16)
const MONTH_GAP = 30 // the least room, in chart units, two month labels need side by side

// The mock's inks (audit F16): a forest line over a light forest fill, labels that matter in bold foreground.
const INK = 'var(--color-muted-foreground)'
const STRONG = 'var(--color-foreground)'
// The posted line, dot and area are classes, so dark mode can lift them (#3207 PR 8: forest-700 all but
// vanishes on a dark card). Light keeps the mock's forest-700 over forest-300.
const POSTED_STROKE = 'stroke-forest-700 dark:stroke-forest-400'
const POSTED_FILL = 'fill-forest-700 dark:fill-forest-400'
const AREA_FILL = 'fill-forest-300 dark:fill-forest-500'
const AMBER = 'var(--color-amber-600)'
const AMBER_INK = 'var(--color-amber-700)' // amber type: amber-600 is the stroke, too light for 10.5px text
const RULE = 'var(--color-border)'

/** The steps an axis may count in (×10ⁿ): round enough to read at a glance. */
const NICE = [1, 2, 2.5, 4, 5, 10]

/**
 * Ruling V5: three round steps that reach the highest figure, so every tick is a round number and the top one is
 * labelled ($400k, $800k, $1.2M for a $1.11M budget). The budget stays on the scale.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure scale function, exported for its unit tests
export function niceTop(highest: number): number {
  if (!(highest > 0)) return 1
  const raw = highest / 3
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = (NICE.find((n) => n * power >= raw) ?? 10) * power
  return step * 3
}

/** A round tick in the chart's own money words: "$400k", "$1.2M" (formatMoneyScale, trailing zeros dropped). */
const tickWords = (value: number) => formatMoneyScale(value).replace(/\.?0+M$/, 'M')

function dayNumber(iso: string): number {
  const d = parseIsoDay(iso.slice(0, 10))
  return d === null ? Number.NaN : Date.UTC(d.year, d.month - 1, d.day) / DAY_MS
}

/**
 * The one chart (design-language §13): what has been posted, week by week, against the budget, with the step
 * up to what is committed once waiting requests are offered. Finance's Today alone.
 *
 * The x range runs from the first week to today plus four weeks. The rules' last round date would be the truer end,
 * but it is not on this read; four weeks of room keeps the labels inside the chart. If today is before the last
 * point (a season read ahead of the calendar), the last point stands in for today.
 */
export function AidBurnUp({
  points,
  budget,
  committed,
}: {
  readonly points: readonly ApiAidWeekPoint[]
  readonly budget: number | null
  readonly committed: number | null
}) {
  const days = points.map((p) => dayNumber(p.week_of))
  if (points.length === 0 || days.some(Number.isNaN)) {
    return <div className={CS_EMPTY}>Nothing posted yet this season.</div>
  }
  const first = days[0] ?? 0
  const lastDay = days[days.length - 1] ?? first
  const lastPosted = points[points.length - 1]?.posted ?? 0
  const nowDay = Math.max(dayNumber(campToday()), lastDay)
  const end = nowDay + 28
  const top = niceTop(Math.max(budget ?? 0, committed ?? 0, lastPosted))

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (day: number) => PAD.left + ((day - first) / (end - first)) * plotW
  const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH

  const line = points
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${x(days[i] ?? first).toFixed(1)},${y(p.posted).toFixed(1)}`
    )
    .join(' ')
  const area = `${line} L${x(lastDay).toFixed(1)},${y(0).toFixed(1)} L${x(first).toFixed(1)},${y(0).toFixed(1)} Z`

  const ticks = [0, top / 3, (2 * top) / 3, top]
  // The first point's month is labelled too, unless the next month starts too close for both to fit.
  const months: Array<{ at: number; label: string }> = []
  const monthOf = (day: number) => MONTHS[new Date(day * DAY_MS).getUTCMonth()] ?? ''
  const nextMonth = (day: number) => {
    const d = new Date(day * DAY_MS)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS
  }
  let cursor = nextMonth(first)
  if (x(cursor) - x(first) >= MONTH_GAP) months.push({ at: first, label: monthOf(first) })
  while (cursor <= end) {
    months.push({ at: cursor, label: monthOf(cursor) })
    cursor = nextMonth(cursor)
  }

  const dotX = x(lastDay)
  const dotY = y(lastPosted)
  const leftSide = dotX < W / 2
  const showStep = committed !== null && committed > lastPosted
  const labelX = leftSide ? dotX + 8 : dotX - 8
  const anchor = leftSide ? 'start' : 'end'
  // Audit N2: the step stands on the posted dot (the mock), never at today's x, so it reads as the line going on up
  // to the committed total. Its top has a dot of its own, and its two-line label starts level with that dot; the
  // posted label sits under it, level with its own dot when there is room (the mock). When that would put the posted
  // label on the axis (a line running along the bottom), the posted label goes just above its dot, clear of the line
  // that rises to it, and the committed label stacks above it. With no step, the posted label sits above its dot.
  const stepTop = showStep ? y(committed) : 0
  let committedY = stepTop + 3.5
  let postedY = showStep ? Math.max(dotY + 3.5, committedY + 12 + 13) : dotY - 7
  if (showStep && postedY > y(0) - 2) {
    postedY = dotY - 7
    committedY = Math.max(Math.min(committedY, postedY - 12 - 13), PAD.top + 10)
  }

  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="block w-full">
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke={RULE}
            strokeOpacity={0.5}
            strokeWidth={1}
          />
          <text
            data-tick
            x={PAD.left - 5}
            y={y(v) + 3.5}
            textAnchor="end"
            fontSize={FONT}
            fill={INK}
          >
            {tickWords(v)}
          </text>
        </g>
      ))}
      {months.map((m) => (
        <text key={m.at} x={x(m.at)} y={H - 4} fontSize={FONT} fill={INK}>
          {m.label}
        </text>
      ))}
      <path d={area} data-area="posted" className={AREA_FILL} fillOpacity={0.3} />
      <path d={line} data-line="posted" fill="none" className={POSTED_STROKE} strokeWidth={2.5} />
      {budget !== null && budget > 0 && (
        <>
          <line
            data-line="budget"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(budget)}
            y2={y(budget)}
            stroke={STRONG}
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text
            x={W - PAD.right}
            y={y(budget) - 4}
            textAnchor="end"
            fontSize={FONT}
            fontWeight={700}
            fill={STRONG}
          >
            {`Budget ${formatMoneyScale(budget)}`}
          </text>
        </>
      )}
      {showStep && (
        <>
          <line
            data-line="committed"
            x1={dotX}
            x2={dotX}
            y1={dotY}
            y2={stepTop}
            stroke={AMBER}
            strokeWidth={2}
            strokeDasharray="3 2"
          />
          <circle data-dot="committed" cx={dotX} cy={stepTop} r={3} fill={AMBER} />
          {/* Ruling V6: a season total (posted + needs an offer + pending approval), so it says "committed". */}
          <text
            data-label="committed"
            x={labelX}
            y={committedY}
            textAnchor={anchor}
            fontSize={FONT}
            fill={INK}
          >
            {/* The figure takes the step's amber, so the words read with the dot they name (audit N2). */}
            <tspan fill={AMBER_INK} fontWeight={700}>
              {`${formatMoneyCompact(committed)} committed `}
            </tspan>
            <tspan x={labelX} dy={12}>
              once waiting is offered
            </tspan>
          </text>
        </>
      )}
      <circle data-dot="posted" cx={dotX} cy={dotY} r={3.5} className={POSTED_FILL} />
      <text
        data-label="posted"
        x={labelX}
        y={postedY}
        textAnchor={anchor}
        fontSize={FONT}
        fontWeight={700}
        fill={STRONG}
      >
        {`${formatMoneyCompact(lastPosted)} posted`}
      </text>
    </svg>
  )
}
