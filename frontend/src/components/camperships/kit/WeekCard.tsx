import { Link } from 'react-router'

import type { ApiAidWeekFeed, ApiAidWeekFigure } from '../../../types/api-types'
import { POOL_NEGATIVE_INK } from './aidStyles'
import { Cut } from './Cut'
import { CS_CARD_HEADING, CS_META } from './csType'
import { campToday, formatShortDate } from './dates'

const CAMP_TIME_ZONE = 'America/Los_Angeles'
/** The column holds the latest six items; the server sends no more, and the cap keeps it from growing if it did. */
const FEED_CAP = 6
const UP_INK = 'text-forest-700 dark:text-forest-300'
const SKY_INK = 'text-sky-700 dark:text-sky-300'

const GLYPH: Record<ApiAidWeekFeed['kind'], string> = {
  posted: '✓',
  accepted: '↩',
  approved: '✓',
  refused: '✕',
  grant: '＋',
  overdue: '!',
  funder: '✎',
}

function glyphInk(kind: ApiAidWeekFeed['kind']): string {
  if (kind === 'overdue') return POOL_NEGATIVE_INK
  if (kind === 'grant') return SKY_INK
  return 'text-muted-foreground'
}

/** Whole dollars, or $Nk from ten thousand up (the column is 340px wide). */
function dollars(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 10000) return `$${String(Math.trunc(abs / 1000))}k`
  return `$${Math.round(abs).toLocaleString('en-US')}`
}

function figureValue(f: ApiAidWeekFigure): string {
  return f.unit === 'dollars' ? dollars(f.value) : f.value.toLocaleString('en-US')
}

function Change({ figure }: { readonly figure: ApiAidWeekFigure }) {
  const delta = figure.value - figure.previous
  if (delta === 0) return null
  const size = Math.abs(delta)
  const words = figure.unit === 'dollars' ? dollars(size) : size.toLocaleString('en-US')
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${delta > 0 ? UP_INK : POOL_NEGATIVE_INK}`}
    >
      {delta > 0 ? '▲' : '▼'} {words}
    </span>
  )
}

/** The clock for an item from today (camp time), else its short weekday. */
function feedTime(at: string, today: string): string {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return ''
  if (campToday(when) === today) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: CAMP_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(when)
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TIME_ZONE, weekday: 'short' }).format(
    when
  )
}

/**
 * Today's movement column (design-language §13): this week's figures against last week's, then the feed.
 * `hrefOf` decides where an item's words go; null leaves them plain.
 */
export function AidWeekCard({
  weekOf,
  figures,
  feed,
  hrefOf,
}: {
  readonly weekOf: string
  readonly figures: readonly ApiAidWeekFigure[]
  readonly feed: readonly ApiAidWeekFeed[]
  readonly hrefOf: (f: ApiAidWeekFeed) => string | null
}) {
  const today = campToday()
  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="flex items-baseline gap-2.5 px-3.5 pt-3">
        <h2 className={CS_CARD_HEADING}>This week</h2>
        <span className={CS_META}>{`Mon ${formatShortDate(weekOf)} – today`}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3.5 py-3">
        {figures.map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col">
            <span className={CS_META}>{f.label}</span>
            <span className="text-[20px] leading-[26px] font-bold tabular-nums">
              {figureValue(f)}
            </span>
            <Change figure={f} />
          </div>
        ))}
      </div>
      {feed.length > 0 && (
        <ul className="border-border divide-border divide-y border-t">
          {feed.slice(0, FEED_CAP).map((item, i) => {
            const href = hrefOf(item)
            return (
              <li
                key={`${item.at}-${String(i)}`}
                className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3.5 py-1.5 text-[13.5px] leading-normal"
              >
                <span className={`text-center font-bold ${glyphInk(item.kind)}`}>
                  {GLYPH[item.kind]}
                </span>
                <span className="min-w-0 truncate">
                  {href === null ? (
                    <Cut text={item.words} />
                  ) : (
                    <Link to={href} className="text-primary font-medium hover:underline">
                      <Cut text={item.words} />
                    </Link>
                  )}
                </span>
                <span className={`${CS_META} tabular-nums`}>{feedTime(item.at, today)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
