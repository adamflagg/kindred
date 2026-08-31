/**
 * A household's year-over-year family-camp record (kindred#2073).
 *
 * The family-camp sibling of the camper journey, and deliberately a SIBLING
 * rather than a second visual language: this copies
 * `camper/CampJourneyTimeline` — the same `bg-card border-border
 * overflow-hidden rounded-2xl border shadow-sm` card, the same
 * `from-forest-600 to-forest-700 bg-gradient-to-r px-5 py-4` band, the same
 * left-rail timeline with a dot, a `w-12 font-display font-bold` year and a
 * muted detail line. Per the root CLAUDE.md §4 rule, every divergence below
 * is justified where it happens.
 *
 * ★ HOUSEHOLD GRAIN, NOT CAMPER GRAIN. A household's party changes
 * composition year to year — children age out, adults change — so each row's
 * members are that year's own, and the "see members" modal is handed one
 * year's row and nothing else.
 *
 * ★ AN EMPTY HOUSING CELL IS NOT MISSING DATA. Measured on the production
 * snapshot 2026-08-09, the same blank means three different things and the
 * server distinguishes them (`HousingState`):
 *
 *   * `placed`     — the staff-written cabin string.
 *   * `unknown`    — the year recorded no cabin for ANYBODY. All of
 *                    2017-2021: 1,433 family registrations, zero cabin
 *                    assignments. Nothing can be said.
 *   * `not_placed` — the year recorded cabins for other households and none
 *                    for this one. On the season being worked that is a
 *                    genuine to-do ("not yet placed"); on a past season it is
 *                    a hole in this family's record ("no cabin on file").
 *
 * Those last two strings are deliberately different words for deliberately
 * different facts, and flattening them is the failure this view exists to
 * avoid.
 *
 * THE NAME COMES FROM `householdIdentity.ts` AND NOWHERE ELSE (kindred#2180).
 * `familyNameLabel` takes the CROSS-YEAR UNION of the children's surnames —
 * it normalises its own input, which is what stops a four-year household
 * reading "The Johnson, johnson & Johnson Family". Do not write a second
 * derivation, and never split a surname on its hyphen: "Garcia-Lopez" is one
 * name.
 */
import { Home, TreePine } from 'lucide-react'
import { useState } from 'react'

import { useHouseholdJourney } from '../../hooks/useWeekendRoster'
import type { HouseholdJourney, HouseholdJourneyRow } from '../../types/lodging'
import { QueryGuard } from '../QueryGuard'
import { Tooltip } from '../ui/Tooltip'
import { childSurnames, familyNameLabel, isAttendingAdultName } from './householdIdentity'
import { HouseholdYearMembersModal } from './HouseholdYearMembersModal'
import { weekendLabel } from './weekendNames'

export interface HouseholdJourneyCardProps {
  /**
   * `null` for a party with no household — an adult weekend enrols the person
   * directly, so there is no household history to look up and nothing is
   * fetched.
   */
  householdCmId: number | null
  /**
   * The season being worked. The ONE place it matters: it is what separates a
   * to-do ("not yet placed") from a hole in the record ("no cabin on file"),
   * which are the same `not_placed` state on the wire.
   */
  currentYear: number
}

/** The heading when no child in any year carries a surname to build one from. */
const NO_NAME_HEADING = 'Family Camp history'

/** The people this row can actually show, which is what gates the affordance. */
function memberCount(row: HouseholdJourneyRow): number {
  // A blank `family_camp_adults` slot is not an attending adult, and neither
  // is a placeholder. The server publishes every row on purpose so one client
  // predicate decides — using it here is what stops a "see members" button
  // opening onto an empty list.
  const adults = (row.adults ?? []).filter((adult) => isAttendingAdultName(adult.display_name))
  return adults.length + (row.children?.length ?? 0)
}

function housingLabel(row: HouseholdJourneyRow, currentYear: number): string {
  if (row.housing === 'placed') return row.cabin_name ?? ''
  if (row.housing === 'not_placed') {
    return (row.year ?? 0) >= currentYear ? 'Not yet placed' : 'No cabin on file'
  }
  return 'Housing unknown'
}

function JourneyRows({
  years,
  currentYear,
  onSeeMembers,
}: {
  years: HouseholdJourneyRow[]
  currentYear: number
  onSeeMembers: (row: HouseholdJourneyRow) => void
}) {
  if (years.length === 0) {
    // The camper journey's "First year at camp!" branch, worded for a
    // household: 604 of the households with any housing history at all were
    // placed in exactly one year, so a short record is ordinary, not an error.
    return (
      <div className="py-4 text-center">
        <TreePine className="text-muted-foreground/50 mx-auto mb-2 h-8 w-8" />
        <p className="text-muted-foreground text-sm">No family camp history on file</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Left-aligned timeline line — CampJourneyTimeline's, unchanged. */}
      <div className="from-forest-300 via-forest-400 to-forest-300 dark:from-forest-700 dark:via-forest-600 dark:to-forest-700 absolute top-1 bottom-1 left-[5px] w-0.5 bg-gradient-to-b" />

      <div className="space-y-2">
        {years.map((row) => {
          const year = row.year ?? 0
          const isCurrentYear = year === currentYear
          const isPlaced = row.housing === 'placed'
          const count = memberCount(row)
          const housing = housingLabel(row, currentYear)
          // kindred#2332. The server resolves `cabin_name` to the unit's
          // PRESENT-DAY registry name, so a 2022 row reads in the language
          // staff use now — which is the whole point, since fourteen of the
          // 118 units were renamed in one two-minute burst on 2026-08-15.
          // `cabin_name_raw` is what was typed that season: real provenance,
          // and not the name.
          //
          // OFFERED ONLY WHERE THE TWO DISAGREE — 716 of 1,861 rows on the
          // snapshot. On the other 1,145 the trigger would decorate a name
          // with a tooltip repeating it back, which is how an affordance stops
          // being read. Absent or blank means an older payload, and the name
          // still renders.
          const rawHousing = (row.cabin_name_raw ?? '').trim()
          const showsProvenance = isPlaced && rawHousing.length > 0 && rawHousing !== housing
          // kindred#2393. `FC1 · FC4`, in the order the server sent — which is
          // the season's own, earliest first. `weekendLabel` is the one
          // sanctioned display use of the slug and falls back to the
          // weekend's short name rather than to its CampMinder id, which
          // names nothing a staff member reads.
          const weekends = (row.sessions ?? []).map((session) => weekendLabel(session.name ?? ''))

          return (
            <div
              key={year}
              data-testid="household-journey-row"
              data-year={String(year)}
              className={`relative flex items-center gap-3 ${isCurrentYear ? '' : 'opacity-75'}`}
            >
              <div
                className={`relative z-10 h-3 w-3 flex-shrink-0 rounded-full ${
                  isCurrentYear
                    ? 'bg-forest-600 ring-forest-100 dark:ring-forest-900 ring-2'
                    : 'bg-forest-400 dark:bg-forest-600'
                }`}
              />

              <span
                className={`font-display w-12 flex-shrink-0 font-bold ${
                  isCurrentYear
                    ? 'text-forest-700 dark:text-forest-300 text-base'
                    : 'text-foreground/80'
                }`}
              >
                {year}
              </span>

              {/* Wraps rather than truncates (kindred#2253): a unit name with
                  a wing or sub-unit suffix lost exactly that suffix to
                  `truncate`'s ellipsis — the half that distinguishes it from
                  a same-building sibling. The card is a fixed-width panel and
                  the rows are short, so a second line costs little. `min-w-0`
                  stays: it is what lets this flex child shrink below its
                  content width at all, which is what makes the wrap happen
                  instead of the row overflowing its card.

                  A DELIBERATE divergence from summer, per the root CLAUDE.md
                  §4 rule: CampJourneyTimeline's own bunk span — this row's
                  direct analog — still truncates
                  (`camper/CampJourneyTimeline.tsx`, the `record.bunkName`
                  span). That surface's cabin names are short, fixed-format
                  callsigns with nothing meaningful to lose to an ellipsis.
                  Family-camp lodging names are staff-typed strings that can
                  carry a wing or sub-unit suffix — exactly the substring
                  `truncate` chops — so summer's treatment does not transfer
                  here and this row earns its own. */}
              {/* Housing and the weekends on ONE wrapping line, separated by a
                  dash (kindred#2393, owner ruling 2026-08-18 — revised).

                  It was a two-row column first, on the reasoning that a
                  416px panel already carries a year, a housing name, a chip
                  and an action. Measured against the production snapshot, the
                  weekend string is far shorter than that assumed: median 3
                  characters ("FC1"), p95 9, and only 65 of 3,113 journey rows
                  name more than one weekend at all. Spending a whole row on a
                  three-character string, on every row of every year, to serve
                  2% of them is the wrong trade.

                  `flex-wrap` is what makes it safe: the worst real row is
                  "FC1 · FC2 · FC3 · Summer FC" (27 chars) beside a 24-char
                  cabin, which wraps to the second line it would have occupied
                  anyway. So the bad case is no worse than the old default and
                  the common case is a row shorter.

                  A DASH here and `·` between weekends, deliberately: one
                  separator for both would read as a flat list of four things
                  rather than a cabin and the weekends it was used for.

                  `items-center`, NOT `items-baseline`. Baseline alignment reads
                  the first flex item's baseline, and that item is the housing
                  span — itself a flex row whose first child is the `Home`
                  icon. An SVG has no text baseline, so the browser synthesises
                  one from its bottom edge and the whole weekend run sat
                  visibly low against the cabin name. Centring sidesteps the
                  synthesis entirely and is what the two sizes (text-sm cabin,
                  text-xs weekends) want anyway.

                  `min-w-0` stays — it is what lets the flex child shrink below
                  its content width, which is what makes the kindred#2253 wrap
                  happen instead of the row overflowing. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span
                  data-testid="household-journey-housing"
                  className={`flex min-w-0 items-center gap-1 text-sm ${
                    isPlaced ? 'text-foreground font-medium' : 'text-muted-foreground italic'
                  }`}
                >
                  {isPlaced && <Home className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />}
                  {/* A real Tooltip and not a `title` (kindred#2177), and the
                    same trigger shape `LodgingUnitCard` gives its occupancy
                    figure. `min-w-0 text-left` is what keeps the kindred#2253
                    wrap: a button centres its text and will not shrink below
                    its content width without it. */}
                  {showsProvenance ? (
                    <Tooltip
                      content={`Recorded as "${rawHousing}" that season`}
                      data-testid="household-journey-housing-provenance"
                      // Hover and focus only. The sentence restates what staff
                      // typed that season and there is nothing to act on, so
                      // the tap-pins default left a bubble stuck open over the
                      // rows below it after a click that meant nothing.
                      pinOnClick={false}
                      className="decoration-muted-foreground/60 min-w-0 text-left underline decoration-dotted underline-offset-2"
                    >
                      {housing}
                    </Tooltip>
                  ) : (
                    housing
                  )}
                </span>

                {/* PLAIN TEXT, not chips (owner ruling 2026-08-18). The row
                  already carries a housing name and a "See members" action; a
                  third decorated element makes none of them readable. The
                  ruling counted a "No enrollment" chip too, which kindred#2516
                  has since deleted -- the ruling holds with one fewer.

                  ⚠️ ONE CABIN, RENDERED ONCE. There is deliberately no cabin
                  against each weekend: `family_camp_registrations` holds a
                  single string per household-year, and repeating it per
                  weekend is the fan-out that manufactured 12 of 17 false
                  multi-family occupancies in the phase-C shareability
                  analysis. There is no explanatory note for the ambiguous
                  case either — the owner struck it, because staff know
                  CampMinder overwrites the source value and it would have sat
                  beside the then-present "No enrollment" chip saying nearly the
                  same thing.

                  Nothing at all when no weekend is knowable: an empty list is
                  the pre-kindred#2420 payload shape, or a year discovered from
                  an ADULT weekend, which never enters `sessions` (kindred#2516).
                  It is not a household that attended none. */}
                {weekends.length > 0 && (
                  <>
                    {/* Its own element, not a prefix inside the label span, so
                        the span's text stays exactly the weekend list — what
                        every assertion about this line reads. */}
                    <span className="text-muted-foreground/50 text-xs">—</span>
                    <span
                      data-testid="household-journey-weekends"
                      className="text-muted-foreground text-xs"
                    >
                      {weekends.join(' · ')}
                    </span>
                  </>
                )}
              </div>

              {/* NOT "a childless family" and NOT an error — 2020's season was
                  cancelled outright and 2021 has no family attendee rows at all
                  despite 247 registrations. The muted chip is the camper
                  journey's own de-emphasis treatment for a row a reader can
                  skip without losing the fact. */}
              {/* No affordance for a year with nobody to show. An empty modal
                  is worse than no button: it reads as a load failure. */}
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onSeeMembers(row)
                  }}
                  aria-label={`See members for ${String(year)}`}
                  className="text-forest-700 hover:text-forest-900 dark:text-forest-300 dark:hover:text-forest-100 ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold underline-offset-2 transition-colors hover:underline"
                >
                  See members
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HouseholdJourneyCard({ householdCmId, currentYear }: HouseholdJourneyCardProps) {
  const { data, isLoading, error } = useHouseholdJourney(householdCmId)
  const [openRow, setOpenRow] = useState<HouseholdJourneyRow | null>(null)

  // An adult weekend guest is person-grain and has no household, so there is
  // nothing to look up. The hook is still called unconditionally above (rules
  // of hooks) and is idle on a null id.
  if (householdCmId === null) return null

  const years = data?.years ?? []
  // The heading spans the WHOLE record, not the newest year: a single year's
  // label changes as children age in and out, which reads as a different
  // family every time staff step through the rows. `familyNameLabel`
  // normalises the union itself (kindred#2180) — the surname repeats once per
  // year here and must still print once.
  const familyLabel = familyNameLabel(years.flatMap((row) => childSurnames(row.children)))

  return (
    <div
      data-testid="household-journey"
      className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="from-forest-600 to-forest-700 bg-gradient-to-r px-5 py-4">
        {/* Wraps rather than truncates, same reasoning as the housing name
            below (kindred#2253): a multi-surname household is exactly as
            likely to overflow this heading as a long unit name is to
            overflow a year row, and the card has room to grow. */}
        <h2
          data-testid="household-journey-title"
          className="font-display flex items-center gap-2 text-lg font-bold text-white"
        >
          <TreePine className="h-5 w-5 flex-shrink-0" />
          {familyLabel.length > 0 ? familyLabel : NO_NAME_HEADING}
        </h2>
        {/* "Years on file", NOT "years at camp". A row can be a registration
            with no enrollment behind it (2020, 2021), so claiming attendance
            would overstate what the record supports — the same correction
            kindred#2123 made to the camper journey's own count.

            Only once the record is actually in hand. The band sits ABOVE the
            guard below, so it renders while the read is in flight and again
            if it fails — and "0 years on file" is a statement of fact, not a
            placeholder: printed over the spinner it tells a staff member a
            four-year family is a first-timer, on every open of the panel. */}
        {data !== undefined && (
          <p className="text-forest-200 mt-1 text-sm">
            {`${String(years.length)} ${years.length === 1 ? 'year' : 'years'} on file`}
          </p>
        )}
      </div>

      <div className="p-5">
        {/* The shared guard, so this surface reports a slow or failed read the
            way every other data-driven surface does — and inline, rather than
            escalating to the page ErrorBoundary: a history that will not load
            must not take the roster down with it. */}
        <QueryGuard<HouseholdJourney>
          isLoading={isLoading}
          error={error}
          data={data}
          label="family history"
          emptyMessage="No family camp history on file"
        >
          {(journey) => (
            <JourneyRows
              years={journey.years ?? []}
              currentYear={currentYear}
              onSeeMembers={setOpenRow}
            />
          )}
        </QueryGuard>
      </div>

      <HouseholdYearMembersModal
        isOpen={openRow !== null}
        onClose={() => {
          setOpenRow(null)
        }}
        row={openRow}
        familyLabel={familyLabel}
      />
    </div>
  )
}

export default HouseholdJourneyCard
