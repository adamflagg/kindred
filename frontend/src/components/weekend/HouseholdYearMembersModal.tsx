/**
 * Who was in a household's party in ONE year (kindred#2073).
 *
 * The "see members" expansion off the family-camp journey. **Children AND
 * adults** — the adults are half the answer here and are not a footnote: a
 * family-camp party is a household, and its adults are the people staff are
 * usually trying to remember.
 *
 * PER YEAR, NEVER CARRIED FORWARD. A household is not a fixed set of people —
 * children age out, adults change — so this renders the rows the server
 * derived for this year and nothing from an adjacent one.
 *
 * ★ AND PER WEEKEND, WHERE THE YEAR HAD MORE THAN ONE (kindred#2393, owner
 * ruling 2026-08-18). A journey row is a household-YEAR, so a family that
 * booked two of a season's weekends collapsed into one merged list: 64 of
 * 5,438 journey household-years are multi-weekend and 7 of those 64 carry a
 * child who did not attend every weekend, which means the merged list
 * overstates at least one weekend's party. The tab strip is what lets a staff
 * member see one weekend's party at a time.
 *
 * ⚠️ THE ADULT LIST IS NOT TABBED, AND CANNOT BE. `family_camp_adults` is
 * household-year grain with NO session dimension — there is no per-weekend
 * truth to filter adults on, and inventing one is kindred#1943, which is
 * blocked on a 2027 form change. The adults render unchanged on every tab.
 *
 * Built on the shared `ui/Modal` primitive rather than a bespoke overlay, so
 * it inherits the portal at `z-[100]` (which is what lets it open on top of
 * the `z-[60]` family panel), the Escape handler, the background `inert`, and
 * the real focus trap `ui/Modal` gained in kindred#2025. Do not hand-roll any
 * of those.
 *
 * There is no camper-journey modal to copy — the camper journey is a sidebar
 * card and a slide-out section. The nearest dark-band header in this repo is
 * `FamilyDetailsPanel`'s, and this imitates it deliberately: same forest
 * gradient, same `truncate text-lg font-bold` heading, same `text-forest-100
 * mt-0.5 text-xs` sub-line. A sibling surface, not a new visual language.
 *
 * A child's name links to their camper detail page FOR THIS ROW'S YEAR
 * (kindred#2329) — `/camper/:id?year=N`, opened in a NEW TAB. Adults never
 * link: `PartyAdult` (from `family_camp_adults`, a name-only scrape) carries
 * no `person_cm_id` to link with, unlike `PartyChild`.
 *
 * Because the link opens elsewhere, THIS tab does not navigate and the modal
 * deliberately stays open — there is no unwind to perform and nothing here
 * talks to `modalStack`. `ui/Modal` still owns the background inert and the
 * overlay token for as long as the modal is mounted, exactly as before.
 */
import { Baby, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { HouseholdJourneyRow } from '../../types/lodging'
import { displayCampMinderAge } from '../../utils/age'
import { Modal } from '../ui/Modal'
import { isAttendingAdultName } from './householdIdentity'
import { weekendLabel } from './weekendNames'

/**
 * Mirrors `CamperLink.tsx`'s own validity check — a CampMinder ID is only
 * ever a positive integer, so this also rules out a stray `0`.
 *
 * `Number.isInteger` matters, not just `> 0` (CodeRabbit review on
 * kindred#2329's PR): `CamperDetail` resolves the id with `parseInt`, which
 * TRUNCATES rather than rejects a fractional value — a link built from
 * `1000001.5` would silently land on person 1000001, a different camper
 * than the one this row is actually showing.
 */
function hasValidPersonCmId(personCmId: number | null | undefined): personCmId is number {
  return personCmId != null && Number.isInteger(personCmId) && personCmId > 0
}

export interface HouseholdYearMembersModalProps {
  isOpen: boolean
  onClose: () => void
  /** The year's own row. `null` closes the modal without unmounting the card. */
  row: HouseholdJourneyRow | null
  /**
   * "The X Family", from the CROSS-YEAR union of the children's surnames.
   * Passed in rather than derived here so the heading is stable as staff step
   * from one year to the next — a single year's label changes as children age
   * in and out, which reads as a different family.
   */
  familyLabel: string
}

const TITLE_ID = 'household-year-members-title'

/**
 * An age or grade we do not have is omitted, never printed as zero.
 *
 * A grade above 12 is omitted too. CampMinder stores 13 for a camper past
 * 12th grade -- 224 `persons` rows carry it and nothing carries more -- so
 * it is a real value with no sensible label. School grades stop at 12; past
 * that we show the age alone rather than inventing a "Grade 13".
 */
const HIGHEST_SCHOOL_GRADE = 12

function childDetail(age: number | null | undefined, grade: number | null | undefined): string {
  const gradeIsShowable =
    grade !== null && grade !== undefined && grade > 0 && grade <= HIGHEST_SCHOOL_GRADE

  return [
    age === null || age === undefined ? '' : `Age ${displayCampMinderAge(age)}`,
    gradeIsShowable ? `Grade ${String(grade)}` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' · ')
}

function MemberSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

export function HouseholdYearMembersModal({
  isOpen,
  onClose,
  row,
  familyLabel,
}: HouseholdYearMembersModalProps) {
  // `null` is the All tab, which is where every year opens.
  //
  // A DELIBERATE DIVERGENCE from the root CLAUDE.md §4 rule that weekend tab
  // state lives in the URL: that rule buys a linkable, reload-surviving tab,
  // and this one has nothing to be linkable FROM. The modal itself is not
  // addressable — the card holds the open row in `useState` — so a search
  // param for its inner filter would outlive the modal that owns it and name
  // a weekend nothing is showing.
  const [selectedCmId, setSelectedCmId] = useState<number | null>(null)
  // Hooks run before the null-row bail-out, so `sessions` is read defensively
  // rather than after it.
  const sessions = row?.sessions ?? []
  // A stale selection resets ITSELF rather than through an effect. The card
  // keeps this component mounted across opens (`row` goes null and back), so
  // a weekend picked on 2025 would otherwise still be selected on 2024, where
  // it names nothing and would empty the list.
  const activeCmId =
    selectedCmId !== null && sessions.some((session) => session.session_cm_id === selectedCmId)
      ? selectedCmId
      : null
  /**
   * `All · FC1 · FC4`. Only where there is something to split.
   *
   * TWO conditions, and the second is the one that matters in practice. More
   * than one weekend is necessary — `All · FC1` cannot change anything, and
   * the journey card's own weekend line already names it. But it is not
   * sufficient: if every child attended every weekend, each tab renders the
   * identical list and the strip invites a staff member to hunt for a
   * difference that is not there.
   *
   * Owner ruling, 2026-08-18: "if all of the members are the same across all
   * sessions, we simply do not offer up the tabbed experience."
   *
   * That is the common case by a wide margin — of every household that has
   * ever attended more than one weekend in a year, only SIX have differing
   * members on the production snapshot.
   *
   * A child with an EMPTY `session_cm_ids` never triggers the strip: empty is
   * "not knowable", such a child stays visible on every tab, and it therefore
   * splits nothing. Only a child with a known, INCOMPLETE weekend list does.
   */
  const membersDifferByWeekend = (row?.children ?? []).some((child) => {
    const attended = child.session_cm_ids ?? []
    if (attended.length === 0) return false
    return sessions.some((session) => !attended.includes(session.session_cm_id ?? 0))
  })
  const showsTabs = sessions.length > 1 && membersDifferByWeekend

  if (row === null) return null

  // A blank `family_camp_adults` slot is not an attending adult — the scrape
  // has five fixed slots and leaves the unused ones empty rather than
  // omitting the row, and a placeholder ("NA") is not a person either. The
  // server publishes every row on purpose so the client applies ONE predicate
  // across every surface; this is that predicate.
  const adults = (row.adults ?? []).filter((adult) => isAttendingAdultName(adult.display_name))
  // A child with NO weekends on file stays visible on every tab. An empty
  // `session_cm_ids` is "not knowable" — an attendee row whose `session`
  // relation did not expand — never "attended nothing", and hiding such a
  // child from every weekend would lose a real member of the party.
  const children = (row.children ?? []).filter(
    (child) =>
      activeCmId === null ||
      (child.session_cm_ids ?? []).length === 0 ||
      (child.session_cm_ids ?? []).includes(activeCmId)
  )
  // Follows the selected tab. A headcount that stayed at the year's total
  // would be the exact overstatement the tabs exist to remove.
  const headcount = adults.length + children.length

  const header = (
    <div className="from-forest-700 via-forest-800 to-forest-900 bg-gradient-to-br p-4 text-white">
      <h2 id={TITLE_ID} className="truncate text-lg font-bold">
        {familyLabel.length > 0 ? familyLabel : 'Household'}
      </h2>
      <p className="text-forest-100 mt-0.5 text-xs">
        {`${String(row.year ?? 0)} · ${String(headcount)} ${headcount === 1 ? 'person' : 'people'}`}
      </p>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={header}
      headerOnDark
      noPadding
      scrollable
      size="md"
      ariaLabelledBy={TITLE_ID}
    >
      <div className="flex flex-col gap-4 p-4">
        {/* The segmented control the weekend surface already uses — the same
            grammar as `HouseholdRosterTable`'s need filters, tightened one
            step for a modal. Buttons and `aria-pressed`, not `role="tablist"`:
            per `frontend/CLAUDE.md`, accessibility here is deliberately
            minimal, and `aria-pressed` is what the sibling control states. */}
        {showsTabs && (
          <div
            data-testid="year-members-weekend-tabs"
            className="bg-muted/50 dark:bg-muted/30 border-border/50 flex flex-wrap items-center gap-1 rounded-xl border p-1"
          >
            {[null, ...sessions.map((session) => session.session_cm_id ?? 0)].map((cmId) => {
              const isSelected = activeCmId === cmId
              const label =
                cmId === null
                  ? 'All'
                  : weekendLabel(
                      sessions.find((session) => session.session_cm_id === cmId)?.name ?? ''
                    )
              return (
                <button
                  key={cmId === null ? 'all' : String(cmId)}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedCmId(cmId)
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200 ${
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {adults.length > 0 && (
          <MemberSection title="Adults" icon={<Users className="h-3.5 w-3.5" />}>
            <ul data-testid="year-members-adults" className="flex flex-col gap-0.5">
              {adults.map((adult, index) => (
                <li
                  key={`${String(adult.adult_number ?? index)}-${String(adult.display_name)}`}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="text-foreground">{adult.display_name}</span>
                  {(adult.relationship ?? '').length > 0 && (
                    <span className="text-muted-foreground text-xs">{adult.relationship}</span>
                  )}
                </li>
              ))}
            </ul>
          </MemberSection>
        )}

        {children.length > 0 && (
          <MemberSection title="Children" icon={<Baby className="h-3.5 w-3.5" />}>
            <ul data-testid="year-members-children" className="flex flex-col gap-0.5">
              {children.map((child, index) => (
                <li
                  key={String(child.person_cm_id ?? index)}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  {/* Full names, one per line. `dedupeChildNames` is deliberately NOT used
                      here: it lifts a shared surname out of a RUN printed on one line, which
                      is the card's treatment. A vertical list has no run to factor out, and
                      dropping the surname from each line would make a mixed-surname household
                      unreadable. */}
                  {hasValidPersonCmId(child.person_cm_id) ? (
                    // NEW TAB, and this row's own year travels with the
                    // link — NOT the app's current year (kindred#2329).
                    // Deliberately NO `onClick={onClose}`: this tab does not
                    // move, so closing the modal here would drop the reader's
                    // place in the roster for a page they are reading
                    // elsewhere. `target="_blank"` also hands the click to
                    // the browser rather than react-router, so no route
                    // change happens in this tab at all.
                    <Link
                      to={`/camper/${String(child.person_cm_id)}${
                        row.year != null ? `?year=${String(row.year)}` : ''
                      }`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground hover:text-primary font-medium transition-colors hover:underline"
                    >
                      {child.display_name}
                    </Link>
                  ) : (
                    // No `person_cm_id` on file for this child — render as
                    // plain text rather than a link that would 404. Per the
                    // corrected issue body, a valid `person_cm_id` always
                    // resolves for ITS OWN year by construction, so the only
                    // reason to fall back here is a missing id, never an
                    // unresolvable one.
                    <span className="text-foreground">{child.display_name}</span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {childDetail(child.age, child.grade)}
                  </span>
                </li>
              ))}
            </ul>
          </MemberSection>
        )}

        {/* NOT "a childless family", and NOT an error. 2020's family season was
            cancelled outright (1,264 attendee rows, none enrolled) and 2021 has no
            family attendee rows at all despite 247 registrations — while
            `family_camp_adults` carries adults for both. Saying so is the whole
            reason `enrollment` is a named state rather than an empty list. */}
        {row.enrollment === 'none_on_file' && (
          <p data-testid="year-members-no-enrollment" className="text-muted-foreground text-xs">
            {`No enrolled child on file for ${String(row.year ?? 0)}. The household is in that
              season's records, but CampMinder has no enrollment against it.`}
          </p>
        )}

        {headcount === 0 && (
          <p className="text-muted-foreground text-sm italic">No members on file for this year.</p>
        )}
      </div>
    </Modal>
  )
}

export default HouseholdYearMembersModal
