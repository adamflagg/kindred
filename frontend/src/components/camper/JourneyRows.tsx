/**
 * The camper journey's rows — the ONE markup for every journey surface: the
 * camper record's `CampJourneyTimeline` (also the Women's/Men's Weekend
 * sidebar, via `weekend/PersonJourneyCard`) and the summer board's camper
 * modal (`CamperDetailsPanel`). Each surface keeps its own container — header,
 * count line, spinner, empty state — and hands its rows here.
 *
 * Owner ruling 2026-09-22, option G2: the whole journey is ONE CSS grid,
 * dot | year | session | cabin | badge, with NO per-row wrapper — every row
 * puts its five cells straight into the same grid, so every cabin starts on
 * the same vertical line whatever the session name beside it. Before this,
 * each row was its own flex line and a cabin started wherever that row's
 * session name happened to end.
 *
 *  - session: `minmax(0, max-content)` — as wide as the widest session name.
 *    A family weekend's subtitle sits UNDER the name (stacked, smaller,
 *    muted), not inline, which keeps this column narrow.
 *  - cabin: `minmax(0, 1fr)` — takes the rest and ellipsizes.
 *  - badge: `auto` — "Now" or a status letter.
 *
 * `data-col` on each cell is a test query handle (test infrastructure, not
 * accessibility — frontend/CLAUDE.md).
 */
import { Fragment } from 'react'
import { Home } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import type { JourneyRow } from './journeyRowModel'

/**
 * The ONE prop that tells the surfaces apart (owner ruling 2026-09-22, late:
 * "every sidebar shows the journey the same compact way; only the full camper
 * page gets full detail"):
 *
 *  - `full` — the camper record page (`/camper/:id`). A family weekend's
 *    subtitle sits under its name.
 *  - `compact` — every SIDEBAR: the summer board's camper modal and the
 *    Women's/Men's Weekend guest sidebar. One type size down, and a family
 *    weekend shows its bare title ("Family Camp 5") with NO subtitle —
 *    owner: "it's kinda obvious".
 *
 * Same markup either way; a variant only picks sizes and whether the
 * subtitle renders. Every grid template is a literal so Tailwind can see it.
 */
const VARIANTS = {
  full: {
    showSubtitle: true,
    grid: 'grid-cols-[0.75rem_3rem_minmax(0,max-content)_minmax(0,1fr)_auto] gap-x-3 gap-y-2',
    line: 'from-forest-300 via-forest-400 to-forest-300 dark:from-forest-700 dark:via-forest-600 dark:to-forest-700 bg-gradient-to-b',
    pastDot: 'bg-forest-400 dark:bg-forest-600',
    currentYear: 'font-display text-forest-700 dark:text-forest-300 text-base font-bold',
    pastYear: 'font-display text-foreground/80 font-bold',
    session: 'text-sm',
    subtitle: 'text-xs',
    cabin: 'text-sm',
    icon: 'h-3.5 w-3.5',
    badge: 'text-[10px]',
  },
  compact: {
    showSubtitle: false,
    grid: 'grid-cols-[0.75rem_2.75rem_minmax(0,max-content)_minmax(0,1fr)_auto] gap-x-2.5 gap-y-1.5',
    line: 'bg-forest-200 dark:bg-forest-800',
    pastDot: 'bg-forest-300 dark:bg-forest-700',
    currentYear: 'text-forest-700 dark:text-forest-300 text-sm font-bold',
    pastYear: 'text-foreground text-sm font-semibold',
    session: 'text-xs',
    subtitle: 'text-[10px]',
    cabin: 'text-xs',
    icon: 'h-3 w-3',
    badge: 'text-[9px]',
  },
} as const

export type JourneyVariant = keyof typeof VARIANTS

interface JourneyRowsProps {
  rows: JourneyRow[]
  variant?: JourneyVariant
}

export function JourneyRows({ rows, variant = 'full' }: JourneyRowsProps) {
  const sz = VARIANTS[variant]
  return (
    <div className="relative">
      {/* The timeline line, centred on the dot column (12px wide, line at
          5px + 1px half-width). */}
      <div className={`absolute top-1 bottom-1 left-[5px] w-0.5 ${sz.line}`} />

      <div data-testid="journey-rows" className={`grid items-center ${sz.grid}`}>
        {rows.map((row) => {
          // A past row is dimmed as a whole; with no row wrapper, every cell
          // carries it.
          const dim = row.isCurrentYear ? '' : 'opacity-75'
          return (
            <Fragment key={row.key}>
              <div
                data-col="dot"
                className={`relative z-10 h-3 w-3 rounded-full ${dim} ${
                  row.isCurrentYear
                    ? row.status
                      ? 'bg-amber-400 ring-2 ring-amber-100 dark:bg-amber-600 dark:ring-amber-900'
                      : 'bg-forest-600 ring-forest-100 dark:ring-forest-900 ring-2'
                    : sz.pastDot
                }`}
              />

              {/* Year — blank for later same-year rows (multi-session). */}
              <div
                data-col="year"
                className={`${row.isCurrentYear ? sz.currentYear : sz.pastYear} ${dim}`}
              >
                {row.showYear ? row.year : ''}
              </div>

              {/* Session, with a family weekend's subtitle stacked UNDER the
                  name. `min-w-0` lets the cell shrink below its `truncate`d
                  content's intrinsic width when the card is narrow. */}
              <div data-col="session" className={`flex min-w-0 flex-col ${dim}`}>
                <span className={`text-muted-foreground min-w-0 truncate ${sz.session}`}>
                  {row.session}
                </span>
                {/* Which family weekend it was — the half that tells two
                    numbered weekends apart, and the half CampMinder buries in
                    a 54-character name. Muted and one size down: it qualifies
                    the session, it is not a second session. The full camper
                    page only — a sidebar (`compact`) shows the bare title. */}
                {sz.showSubtitle && row.subtitle !== undefined && (
                  <span
                    className={`text-muted-foreground/70 min-w-0 truncate leading-tight ${sz.subtitle}`}
                  >
                    {row.subtitle}
                  </span>
                )}
                {/* NO "Family" TAG. #2113 added one when family rows first
                    entered the journey, so a reader could visually skip a run
                    of them. The session name now begins "Family Camp", which
                    says the same thing where a reader is already looking —
                    owner, 2026-08-18: "we also dont need the 'family' tag in
                    the journey, staff knows." */}
              </div>

              {/* Housing. An empty cell when there is no label — the cell
                  itself stays, or every later cell would slide one column
                  left. Inside: `min-w-0` lets the span shrink below its
                  content; the Home icon stays fixed (flex-shrink-0).
                  `truncate` (text-overflow) does NOTHING on the flex span
                  itself — text-overflow only applies to a block container —
                  so it sits on the element that actually holds the TEXT: a
                  plain `<span>` for the no-tooltip case, or a `<span>`
                  WRAPPING the Tooltip's children for the tooltip case. It
                  never goes on the Tooltip trigger BUTTON (its `className`
                  prop) — that would clip the 24px hit area the button draws
                  with its `after:` pseudo-element (`HIT_TARGET` in
                  ui/Tooltip.tsx). */}
              <div data-col="cabin" data-testid="journey-cabin-cell" className={`min-w-0 ${dim}`}>
                {row.cabin !== undefined && (
                  <span
                    className={`flex min-w-0 items-center gap-1 ${sz.cabin} ${
                      row.cabin === 'Unassigned'
                        ? 'text-amber-600 italic dark:text-amber-400'
                        : 'text-foreground font-medium'
                    }`}
                  >
                    <Home className={`${sz.icon} flex-shrink-0 opacity-60`} />
                    {/* The as-typed string, offered in a hover tooltip, ONLY
                        where it disagrees with the label —
                        `HouseholdJourneyCard`'s `showsProvenance` affordance
                        (kindred#2177 real Tooltip, not `title`), owner ruling
                        2026-09-22 evening. */}
                    {row.cabinRecorded !== undefined ? (
                      <Tooltip
                        content={`Recorded as "${row.cabinRecorded}" that season`}
                        data-testid="camp-journey-cabin-provenance"
                        pinOnClick={false}
                        className="decoration-muted-foreground/60 min-w-0 text-left underline decoration-dotted underline-offset-2"
                      >
                        <span className="block truncate">{row.cabin}</span>
                      </Tooltip>
                    ) : (
                      <span className="min-w-0 truncate">{row.cabin}</span>
                    )}
                  </span>
                )}
              </div>

              {/* Badge — a non-enrolled row's status letter, or "Now" on the
                  first enrolled current-year row. Never both. */}
              <div data-col="badge" className={dim}>
                {row.status ? (
                  <span
                    className={`rounded px-1 py-0.5 leading-none font-bold ${sz.badge} ${row.status.colorClass}`}
                    title={row.status.title}
                  >
                    {row.status.letter}
                  </span>
                ) : (
                  row.showNow && (
                    <span
                      className={`bg-forest-600 rounded px-1.5 py-0.5 font-bold text-white ${sz.badge}`}
                    >
                      Now
                    </span>
                  )
                )}
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

export default JourneyRows
