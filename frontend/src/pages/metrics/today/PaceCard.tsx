/**
 * Analytics › Today › Pace (#3207 PR 8): this season's enrolled camper-sessions by registration day against
 * last year's, from Velocity's own read (its numbers and their meaning are Velocity's). The kit's burn-up
 * grammar (AidBurnUp) for counts: forest line over a light forest area, last year dashed in stone, with
 * the dark-mode ink the shared chart now carries.
 */
import { Link, useLocation } from 'react-router'
import { DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { niceTop } from '../../../components/camperships/kit/BurnUp'
import {
  CS_CARD_HEADING,
  CS_EMPTY,
  CS_LINK_SM,
  CS_SMALL,
} from '../../../components/camperships/kit/csType'
import { formatCount } from '../../../utils/numberFormat'
import type { VelocityResponse } from '../../../types/velocity'
import { analyticsHref } from './todayModel'

const W = 300
const H = 150
const PAD = { left: 38, right: 8, top: 12, bottom: 20 }
const FONT = 10.5
const INK = 'var(--color-muted-foreground)'
const STRONG = 'var(--color-foreground)'
const PRIOR = 'var(--color-stone-400)'
const RULE = 'var(--color-border)'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

interface Point {
  day_offset: number
  enrolled: number
}

/** The last point at or before `day`, or null. */
function atDay(points: readonly Point[], day: number): Point | null {
  let hit: Point | null = null
  for (const p of points) if (p.day_offset <= day) hit = p
  return hit
}

function PaceChart({
  data,
  year,
  priorYear,
}: {
  data: VelocityResponse
  year: number
  priorYear: number
}) {
  const current = [...data.combined.daily].sort((a, b) => a.day_offset - b.day_offset)
  const prior = [...(data.prior_years.find((p) => p.year === priorYear)?.daily ?? [])].sort(
    (a, b) => a.day_offset - b.day_offset
  )
  const last = current.at(-1)
  if (!last) return <div className={CS_EMPTY}>No sign-ups to draw yet.</div>

  const nowDay = data.current_day_offset ?? last.day_offset
  const now = atDay(current, nowDay)?.enrolled ?? 0
  const priorDay = data.prior_day_offset ?? nowDay
  const priorNow = atDay(prior, priorDay)?.enrolled ?? null
  const priorFinal = prior.at(-1)?.enrolled ?? null

  const x0 = Math.min(0, current[0]?.day_offset ?? 0)
  const x1 = Math.max(prior.at(-1)?.day_offset ?? 0, nowDay + 28)
  const top = niceTop(Math.max(priorFinal ?? 0, now))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (d: number) => PAD.left + ((d - x0) / (x1 - x0 || 1)) * plotW
  const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH
  const path = (pts: readonly Point[]) =>
    pts
      .filter((p) => p.day_offset >= x0)
      .map(
        (p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day_offset).toFixed(1)},${y(p.enrolled).toFixed(1)}`
      )
      .join(' ')
  const shown = current.filter((p) => p.day_offset <= nowDay)
  const line = path(shown)
  const area = `${line} L${x(nowDay).toFixed(1)},${y(0).toFixed(1)} L${x(shown[0]?.day_offset ?? x0).toFixed(1)},${y(0).toFixed(1)} Z`

  // A month label at the first of every other month along the season
  const start = Date.parse(`${data.season_start.slice(0, 10)}T12:00:00Z`)
  const months: Array<{ at: number; label: string }> = []
  if (!Number.isNaN(start)) {
    const first = new Date(start + x0 * DAY_MS)
    for (let m = 1; m < 14; m += 2) {
      const d = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m, 1)
      const day = Math.round((d - start) / DAY_MS)
      if (day > x1 - 10) break
      months.push({ at: day, label: MONTHS[new Date(d).getUTCMonth()] ?? '' })
    }
  }

  const ticks = [0, top / 3, (2 * top) / 3, top]
  const dx = x(nowDay)
  const dy = y(now)
  const left = dx < W / 2
  const lx = left ? dx + 8 : dx - 8
  const anchor = left ? 'start' : 'end'
  const ly = Math.min(dy + 16, y(0) - 18)
  const finalX = dx > W - PAD.right - 130 ? dx - 6 : W - PAD.right

  return (
    <>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="block w-full">
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={RULE}
              strokeOpacity={0.5}
              strokeWidth={1}
            />
            <text x={PAD.left - 5} y={y(v) + 3.5} textAnchor="end" fontSize={FONT} fill={INK}>
              {formatCount(Math.round(v))}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.at} x={x(m.at)} y={H - 4} fontSize={FONT} fill={INK}>
            {m.label}
          </text>
        ))}
        {prior.length > 0 && (
          <path
            d={path(prior)}
            data-line="prior"
            fill="none"
            stroke={PRIOR}
            strokeWidth={1.75}
            strokeDasharray="4 3"
          />
        )}
        {priorFinal != null && (
          <text x={finalX} y={y(priorFinal) - 4} textAnchor="end" fontSize={FONT} fill={INK}>
            {String(priorYear)} final {formatCount(priorFinal)}
          </text>
        )}
        <path d={area} className="fill-forest-300 dark:fill-forest-500" fillOpacity={0.3} />
        <path
          d={line}
          data-line="current"
          fill="none"
          className="stroke-forest-700 dark:stroke-forest-400"
          strokeWidth={2.5}
        />
        {priorNow != null && (
          <circle
            cx={dx}
            cy={y(priorNow)}
            r={2.5}
            fill="var(--color-card)"
            stroke={PRIOR}
            strokeWidth={1.5}
          />
        )}
        <line
          x1={dx}
          x2={dx}
          y1={PAD.top}
          y2={y(0)}
          stroke={STRONG}
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <circle cx={dx} cy={dy} r={3.5} className="fill-forest-700 dark:fill-forest-400" />
        <text x={lx} y={ly} textAnchor={anchor} fontSize={FONT} fontWeight={700} fill={STRONG}>
          {formatCount(now)} today
        </text>
        {priorNow != null && (
          <text x={lx} y={ly + 12} textAnchor={anchor} fontSize={FONT} fill={INK}>
            {String(priorYear)}: {formatCount(priorNow)}
          </text>
        )}
      </svg>
      <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3.5 text-[12px] leading-4">
        <span className="whitespace-nowrap">
          <i className="bg-forest-700 dark:bg-forest-400 mr-1 inline-block h-[3px] w-3.5 rounded-sm align-middle" />
          {String(year)}
        </span>
        <span className="whitespace-nowrap">
          <i className="mr-1 inline-block w-3.5 border-t-2 border-dashed border-stone-400 align-middle" />
          {String(priorYear)}, same registration day
        </span>
      </div>
    </>
  )
}

export function PaceCard({ data, year }: { data: VelocityResponse; year: number }) {
  return <PaceChart data={data} year={year} priorYear={year - 1} />
}

export function PaceHead({ sessionsNote }: { sessionsNote: number | undefined }) {
  const location = useLocation()
  return (
    <div className="flex items-baseline gap-2 px-3.5 pt-[9px]">
      <h2 className={CS_CARD_HEADING}>Pace</h2>
      <span className={CS_SMALL}>
        camper-sessions
        {sessionsNote !== undefined && <DefRef n={sessionsNote} />} · by registration day
      </span>
      <Link
        className={`${CS_LINK_SM} ml-auto whitespace-nowrap`}
        to={analyticsHref('/analytics/trends/velocity', location.search)}
      >
        Velocity ›
      </Link>
    </div>
  )
}
