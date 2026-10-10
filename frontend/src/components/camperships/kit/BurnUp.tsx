import type { ApiAidWeekPoint } from '../../../types/api-types'
import { CS_EMPTY } from './csType'
import { campToday, parseIsoDay } from './dates'

const W = 300
const H = 150
const PAD = { left: 38, right: 8, top: 12, bottom: 18 }
const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FONT = 9
const MONTH_GAP = 30 // the least room, in chart units, two month labels need side by side

const INK = 'var(--color-muted-foreground)'
const POSTED = 'var(--color-primary)'
const AMBER = 'var(--color-amber-600)'

function dayNumber(iso: string): number {
  const d = parseIsoDay(iso.slice(0, 10))
  return d === null ? Number.NaN : Date.UTC(d.year, d.month - 1, d.day) / DAY_MS
}

/** $843k, $1.11M: thousands rounded, millions to `decimals` places. */
function short(n: number, decimals: number): string {
  if (n >= 999_500) return `$${(n / 1_000_000).toFixed(decimals)}M`
  if (n >= 1000) return `$${String(Math.round(n / 1000))}k`
  return `$${String(Math.round(n))}`
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
  const top = Math.max(budget ?? 0, committed ?? 0, lastPosted) * 1.08 || 1

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

  const ticks = [0, top / 3, (2 * top) / 3]
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
  const todayX = x(nowDay)
  const leftSide = dotX < W / 2
  const showStep = committed !== null && committed > lastPosted

  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="block w-full" role="img">
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke={INK}
            strokeOpacity={0.25}
            strokeWidth={0.5}
          />
          <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={FONT} fill={INK}>
            {v === 0 ? '$0' : short(v, 1)}
          </text>
        </g>
      ))}
      {months.map((m) => (
        <text key={m.at} x={x(m.at)} y={H - 5} fontSize={FONT} fill={INK}>
          {m.label}
        </text>
      ))}
      <path d={area} fill={POSTED} fillOpacity={0.12} />
      <path d={line} data-line="posted" fill="none" stroke={POSTED} strokeWidth={1.75} />
      {budget !== null && budget > 0 && (
        <>
          <line
            data-line="budget"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(budget)}
            y2={y(budget)}
            stroke={INK}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text x={PAD.left + 4} y={y(budget) - 3} fontSize={FONT} fill={INK}>
            {`Budget ${short(budget, 2)}`}
          </text>
        </>
      )}
      {showStep && (
        <>
          <line
            data-line="committed"
            x1={todayX}
            x2={todayX}
            y1={dotY}
            y2={y(committed)}
            stroke={AMBER}
            strokeWidth={1.5}
            strokeDasharray="1.5 2.5"
            strokeLinecap="round"
          />
          <text
            x={W - PAD.right}
            y={Math.max(y(committed) - 3, FONT)}
            textAnchor="end"
            fontSize={FONT}
            fill={AMBER}
          >
            {`${short(committed, 2)} once waiting is offered`}
          </text>
        </>
      )}
      <circle cx={dotX} cy={dotY} r={3} fill={POSTED} />
      <text
        x={leftSide ? dotX + 6 : dotX - 6}
        y={leftSide ? dotY + 12 : dotY - 5}
        textAnchor={leftSide ? 'start' : 'end'}
        fontSize={FONT}
        fontWeight={600}
        fill={POSTED}
      >
        {`${short(lastPosted, 2)} posted`}
      </text>
    </svg>
  )
}
