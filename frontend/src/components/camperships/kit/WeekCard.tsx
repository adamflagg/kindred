import { Link } from 'react-router'

import type { ApiAidWeekFeed, ApiAidWeekFigure } from '../../../types/api-types'
import { POOL_NEGATIVE_INK } from './aidStyles'
import { CS_BODY, CS_CARD_HEADING, CS_SMALL } from './csType'
import { campToday, formatShortDate } from './dates'
import { formatMoneyFigure } from './money'

const CAMP_TIME_ZONE = 'America/Los_Angeles'
/** The column holds the latest six items; the server sends no more, and the cap keeps it from growing if it did. */
const FEED_CAP = 6
const UP_INK = 'text-forest-700 dark:text-forest-300'
const SKY_INK = 'text-sky-700 dark:text-sky-300'

const GLYPH: Record<ApiAidWeekFeed['kind'], string> = {
  posted: '✓',
  accepted: '↩',
  approved: '✓',
  grant: '＋',
  overdue: '!',
  funder: '✎',
  section: '✎',
}

/** The mock's glyph inks: forest by default, sky for a grant, amber for something overdue. */
function glyphInk(kind: ApiAidWeekFeed['kind']): string {
  if (kind === 'overdue') return POOL_NEGATIVE_INK
  if (kind === 'grant') return SKY_INK
  return UP_INK
}

function figureValue(f: ApiAidWeekFigure): string {
  if (f.blank) return '—' // owner ruling 20: nothing could be counted; the title says why
  return f.unit === 'dollars' ? formatMoneyFigure(f.value) : f.value.toLocaleString('en-US')
}

/** The change against last week, beside the figure. None when it did not move, or when last week had nothing to
 *  compare with (audit F20: "▲ 54" against an empty week reads as a gain). */
function Change({ figure }: { readonly figure: ApiAidWeekFigure }) {
  const delta = figure.value - figure.previous
  if (delta === 0 || figure.previous === 0) return null
  const size = Math.abs(delta)
  const words = figure.unit === 'dollars' ? formatMoneyFigure(size) : size.toLocaleString('en-US')
  return (
    <span
      className={`ml-1 text-xs font-semibold tabular-nums ${delta > 0 ? UP_INK : POOL_NEGATIVE_INK}`}
    >
      {delta > 0 ? '▲' : '▼'} {words}
    </span>
  )
}

/** An item's words with only its marked name as the link, bold in foreground ink (audit R23, the mock's feed). */
function FeedWords({
  item,
  href,
}: {
  readonly item: ApiAidWeekFeed
  readonly href: string | null
}) {
  const name = item.name ?? ''
  const at = name === '' ? -1 : item.words.indexOf(name)
  if (at < 0 || href === null) return <>{item.words}</>
  return (
    <>
      {item.words.slice(0, at)}
      <Link to={href} className="text-foreground font-semibold hover:underline">
        {name}
      </Link>
      {item.words.slice(at + name.length)}
    </>
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
      <div className="flex items-baseline gap-2 px-3.5 pt-[9px]">
        <h2 className={CS_CARD_HEADING}>This week</h2>
        <span className={CS_SMALL}>{`Mon ${formatShortDate(weekOf)} – today`}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3.5 pt-2 pb-2.5">
        {figures.map((f) => (
          <div key={f.key} className="min-w-0" title={f.title === '' ? undefined : f.title}>
            <span className={`${CS_SMALL} block whitespace-nowrap`}>{f.label}</span>
            <span className="whitespace-nowrap">
              <span className="text-[20px] leading-[26px] font-bold tabular-nums">
                {figureValue(f)}
              </span>
              {f.blank ? null : f.note ? (
                <span className="text-muted-foreground ml-1 text-xs font-semibold tabular-nums">
                  {f.note}
                </span>
              ) : (
                <Change figure={f} />
              )}
            </span>
          </div>
        ))}
      </div>
      {feed.length === 0 ? (
        // Ruling W6: the feed is this week only, so a quiet week says so in one muted line.
        <p
          className={`border-border text-muted-foreground border-t px-3.5 pt-1.5 pb-2.5 ${CS_BODY}`}
        >
          Nothing yet this week
        </p>
      ) : (
        <ul className="border-border flex flex-col border-t px-3.5 pt-1.5 pb-2.5">
          {feed.slice(0, FEED_CAP).map((item, i) => (
            <li
              key={`${item.at}-${String(i)}`}
              // Audit N3: the kit's card text size (CS_BODY's 13.5px) on the mock's 17px lines, so a row is ~25px.
              className="border-border grid grid-cols-[18px_minmax(0,1fr)_auto] items-baseline gap-x-2 border-b border-dashed py-1 text-[13.5px] leading-[17px] last:border-b-0"
            >
              <span className={`text-center font-bold ${glyphInk(item.kind)}`}>
                {GLYPH[item.kind]}
              </span>
              <span className="min-w-0 truncate" title={item.words}>
                <FeedWords item={item} href={hrefOf(item)} />
              </span>
              <span className={`${CS_SMALL} whitespace-nowrap tabular-nums`}>
                {feedTime(item.at, today)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
