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
 */
import { Baby, Users } from 'lucide-react'

import type { HouseholdJourneyRow } from '../../types/lodging'
import { displayCampMinderAge } from '../../utils/age'
import { Modal } from '../ui/Modal'
import { isAttendingAdultName } from './householdIdentity'

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

/** An age or grade we do not have is omitted, never printed as zero. */
function childDetail(age: number | null | undefined, grade: number | null | undefined): string {
  return [
    age === null || age === undefined ? '' : `Age ${displayCampMinderAge(age)}`,
    grade === null || grade === undefined || grade === 0 ? '' : `Grade ${String(grade)}`,
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
  if (row === null) return null

  // A blank `family_camp_adults` slot is not an attending adult — the scrape
  // has five fixed slots and leaves the unused ones empty rather than
  // omitting the row, and a placeholder ("NA") is not a person either. The
  // server publishes every row on purpose so the client applies ONE predicate
  // across every surface; this is that predicate.
  const adults = (row.adults ?? []).filter((adult) => isAttendingAdultName(adult.display_name))
  const children = row.children ?? []
  const headcount = adults.length + children.length

  const header = (
    <div className="from-forest-700 via-forest-800 to-forest-900 bg-gradient-to-br p-4 pr-12 text-white">
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
        {adults.length > 0 && (
          <MemberSection title="Adults" icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}>
            {/* NOT redundant: Tailwind Preflight sets list-style: none on every <ul>, which strips
                the implicit `list` role in Safari's a11y tree unless role="list" is explicit. Same
                pattern as FamilyDetailsPanel. */}
            {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
            <ul data-testid="year-members-adults" className="flex flex-col gap-0.5" role="list">
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
          <MemberSection
            title="Children"
            icon={<Baby className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- see above */}
            <ul data-testid="year-members-children" className="flex flex-col gap-0.5" role="list">
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
                  <span className="text-foreground">{child.display_name}</span>
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
          <p data-testid="year-members-no-enrolment" className="text-muted-foreground text-xs">
            {`No enrolled child on file for ${String(row.year ?? 0)}. The household is in that
              season's records, but CampMinder has no enrolment against it.`}
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
