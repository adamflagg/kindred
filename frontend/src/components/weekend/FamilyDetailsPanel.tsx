/**
 * Everything the family card omits (spec §3.9).
 *
 * This is what makes §3.8's three omissions a DEFERRAL rather than a loss —
 * the request text and the medical narrative are one click away, not gone.
 * Request text is unchanged in REACH, only in placement: it already renders on
 * the roster row through the same `ShareRequestPanel`. Moving it here rather
 * than onto 62 simultaneously-visible cards is the whole of the narrowing.
 *
 * The slide-in shell itself -- animated close, click-outside layer, overlay
 * token, header -- is `SlideInPanel`, shared with the write-in panel.
 *
 * **Mirror the contract, not the code.** `CamperDetailsPanel` is 1442 lines and
 * deeply camper-coupled — bunk requests, satisfaction buckets, AG collapse,
 * camper journeys. None of it is reused. What is copied is the interaction
 * shape the board already implements: `{ onClose, requestClose }`,
 * `requestClose` driving an animated close, the `pointer-events-none fixed
 * inset-0 z-[59]` click-outside layer, and `shouldKeepPanelsOpen` for
 * dismissal.
 *
 * **One component, both surfaces.** The board and the map both open this same
 * slide-in overlay — there is no second implementation to keep in sync.
 */
import { Baby, Clock, Home, Repeat, Star, Users } from 'lucide-react'
import { Link } from 'react-router'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { displayCampMinderAge } from '../../utils/age'
import { formatGradeName } from '../../utils/gradeUtils'
import { Tooltip } from '../ui/Tooltip'
import { HouseholdJourneyCard } from './HouseholdJourneyCard'
import { namedAdults, partyFamilyLabel, partyHeadcount } from './householdIdentity'
import { Section } from './PanelSection'
import { partyKey } from './partyKey'
import { PartyRequestSections } from './PartyRequestSections'
import { PersonJourneyCard } from './PersonJourneyCard'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'
import { SlideInPanel } from './SlideInPanel'

export interface FamilyDetailsPanelProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined for a merge. */
  unit?: LodgingUnitRow | undefined
  year: number
  /** Parent-driven animated close, as the summer board does. */
  requestClose?: boolean
  onClose: () => void
  /**
   * kindred#2650 follow-up. The click-outside layer (`family-panel-backdrop`
   * below) is `pointer-events-none` by default, DELIBERATELY: it lets a
   * click pass through to a board card/row underneath and switch families
   * directly, the contract `CamperDetailsPanel`'s identical backdrop also
   * has, exercised by every OTHER `FamilyDetailsPanel` caller
   * (`LodgingBoard`, `LodgingMap`, `HouseholdRosterTable`).
   *
   * `WeekendRosterPage`'s `familyPanelParty` site is different: it can open
   * this panel FROM WITHIN an already-open `ui/Modal`
   * (`CabinWeekendModal`), rendered — per its own divergence comment — in a
   * portal OUTSIDE `#root`'s `inert` subtree specifically so this panel
   * stays genuinely interactive there. A `pointer-events-none` backdrop in
   * THAT configuration is a hole, not a feature: nothing is meant to be
   * reached "through" it (there is no board underneath, only the modal that
   * spawned this panel), so a real click physically falls through to the
   * MODAL's own backdrop instead — which cannot tell "outside both" apart
   * from "on this panel's own content", because both routes land on the
   * identical DOM node once the panel is invisible to hit-testing (measured
   * against real Chromium; see `FamilyDetailsPanel.test.tsx`'s comment on
   * `handleBackdropClick` for the detail). Passing `true` here makes the
   * backdrop `pointer-events-auto`, so it correctly catches a genuine
   * outside click ITSELF instead of leaking it to whatever sits beneath.
   */
  backdropInteractive?: boolean
  /**
   * The weekend's `session_type` (kindred#2759), forwarded to
   * `PartyRequestSections`, which reads it ONLY through `isAdultSessionType`
   * — never the party's grain — to draw the adult guest's Jotform section.
   */
  sessionType?: string | undefined
}

export function FamilyDetailsPanel({
  party,
  unit,
  year,
  requestClose = false,
  onClose,
  backdropInteractive = false,
  sessionType,
}: FamilyDetailsPanelProps) {
  // A blank `family_camp_adults` slot is not an attending adult -- rendering
  // it left an empty <li> in the Party list (kindred#2084 scan finding).
  const adults = namedAdults(party)
  const children = party.children ?? []
  const isHousehold = party.grain === 'household'
  // A person-grain party has no household, and the API sends 0 rather than
  // omitting the field. `null` says "nothing to look up", so the medical
  // narrative is not fetched where it could only ever 404.
  const householdCmId = isHousehold ? (party.household_cm_id ?? 0) : 0
  // "The X Family", built from the children's deduplicated surnames
  // (kindred#2180, owner ruling 2026-08-09). It REPLACES the attending-adult
  // headline kindred#2084 installed here; the adults are not lost and are not
  // demoted to a sub-line -- they are in the Party list below, with the kids.
  //
  // This is not the salutation coming back. That was CampMinder's
  // `mailing_title`, which disagreed with the real adult list on 26.7% of
  // 2026's 382 rostered households, in both directions; a surname derived
  // from the children's own `persons.last_name` carries none of that. The
  // four OTHER surfaces (`HouseholdRosterRow`, `MapUnitPopover`,
  // `FloatingUnplacedBadge`, and the card's grey line) still show the adult
  // list -- this replacement is scoped to the panel headline, where there is
  // a full members list one section down to carry the names.
  //
  // `partyFamilyLabel` falls all the way back through the adult list to the
  // salutation, so a party whose children carry no surname still has a
  // heading.
  const identityLabel = partyFamilyLabel(party)
  const attention = partyAttention(party, unit)
  const isPlaced = (party.unit_name ?? '').length > 0
  // NOT `party.party_size` — that became a BED count under kindred#1925/
  // #2046 (it drops blank/placeholder adult slots and discounts an
  // under-18-month infant) and can legitimately disagree with the adults and
  // children this panel prints just below. `partyHeadcount` is that printed
  // count, the same one FamilyCard's own badge uses, so the two surfaces —
  // and this panel's own list — can never disagree with each other
  // (kindred#2152).
  //
  // Named `headcount`, NOT `partySize`: "party size" is the bed number now
  // (`boardLayout.partySize`, `rosterAttention.partySpots`), and a local of
  // that name holding the other figure is the exact confusion this issue
  // exists to end.
  const headcount = partyHeadcount(party)

  const body = (
    <div className="flex flex-col gap-4 p-4">
      <Section title="Placement">
        <div className="flex flex-wrap items-center gap-2">
          <Home className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          {isPlaced ? (
            <span className="text-foreground text-sm font-medium">{party.unit_name}</span>
          ) : (
            <span className="text-muted-foreground text-sm italic">No cabin yet</span>
          )}
          {party.is_merged_slot === true && (
            <Tooltip
              content="Two rooms combined into one slot"
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              Merged
            </Tooltip>
          )}
          {unit?.area_name !== undefined && unit.area_name.length > 0 && (
            <span className="text-muted-foreground text-xs">{unit.area_name}</span>
          )}
        </div>
        {/* ⚠️ `unverified` IS EXCLUDED HERE, AND THE BAND STILL EXISTS. Do not
            "restore" this as an oversight, and do not delete the band it hides.

            `rosterAttention.ts` still produces `unverified` and it still guards
            kindred#1982: a resolved `private` with no cabin behind it must not
            read as `settled`. kindred#2526 confirmed both live producers — a
            GENERIC accommodation request no cabin field can settle, and a
            placement whose unit cannot be resolved — after checking them.

            What went is only the DISPLAY, and only here: owner ruling
            2026-08-27, that "Fit not verified" adds nothing in this panel. The
            reader is already looking at the cabin name, the merged badge and
            the area on the line above, and the Housing needs section below
            names the ask itself; a fourth line saying the fit was not checked
            told them nothing they could act on.

            `settled` and `unplaced` were already out — `settled` carries no
            words and "No cabin yet" is printed above. `required` and `unmet`
            still print, because both name something the reader must fix. */}
        {attention.level !== 'settled' &&
          attention.level !== 'unplaced' &&
          attention.level !== 'unverified' && (
            <p className="text-muted-foreground flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="font-medium">{ATTENTION_LABEL[attention.level]}</span>
              {attention.reason.length > 0 && <span>{attention.reason}</span>}
            </p>
          )}
      </Section>

      <Section title="Party">
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {`${String(headcount)} ${headcount === 1 ? 'person' : 'people'}`}
          </span>
          {(party.arrival_eta ?? '').length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {party.arrival_eta}
            </span>
          )}
          {party.is_returning === true && (
            <span className="text-forest-700 dark:text-forest-300 inline-flex items-center gap-1 font-semibold">
              <Repeat className="h-3.5 w-3.5" />
              Returning
            </span>
          )}
          {/* Both grains since kindred#2767 (owner ruling 2026-09-23, one
              returning rule): the server computes `is_returning` for an adult
              weekend guest too, from any prior enrolled adult session by the
              guest's own id, so `false` is a real "no" at either grain. */}
          {party.is_returning !== true && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
              <Star className="h-3.5 w-3.5" />
              First-time
            </span>
          )}
        </div>

        {isHousehold && adults.length > 0 && (
          <ul data-testid="family-panel-adults" className="flex flex-col gap-0.5">
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
        )}

        {children.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {children.map((child, index) => (
              <li
                key={String(child.person_cm_id ?? index)}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="text-foreground">{child.display_name}</span>
                {/* The Baby mark's own pink, the same hue `FamilyCard` draws
                    it in and `unplacedFilters` names — deliberately outside
                    the closed four-hue need set, because under-2 is an
                    ungraded fact about the party rather than a need matched
                    against a cabin. NOT sky, which is `bathroom`'s need hue
                    in `NEED_GLYPHS`: spending it here would put one colour on
                    two meanings a few rows apart. */}
                {/* `self-center`, because the row is `items-baseline` and an
                    SVG HAS NO TEXT BASELINE — the browser synthesises one from
                    its bottom edge, so a 14px box hung from the baseline runs
                    its full height ABOVE it while the text's cap reaches only
                    ~10px, and the mark sits visibly high against the name
                    either side of it (owner, 2026-08-27). The same synthesis
                    is what `HouseholdJourneyCard`'s housing row documents and
                    what `FamilyCard`'s single-parent mark was measured against.
                    Centring sidesteps it entirely.

                    Scoped to the ICON rather than switching the `<li>` to
                    `items-center`: baseline is right for the two TEXT spans
                    here, which are different sizes (text-sm name, text-xs
                    age·grade) and should sit on one line, and every child row
                    without a mark must stay pixel-identical. */}
                {child.is_under_two === true && (
                  <Baby
                    data-testid={`under-two-${String(child.person_cm_id ?? index)}`}
                    className="h-3.5 w-3.5 flex-shrink-0 self-center text-pink-500 dark:text-pink-400"
                  />
                )}
                <span className="text-muted-foreground text-xs">
                  {/* An age or grade we do not have is omitted, never zero. */}
                  {[
                    child.age === null || child.age === undefined
                      ? ''
                      : `Age ${displayCampMinderAge(child.age)}`,
                    formatGradeName(child.grade_name, 'short') ?? '',
                  ]
                    .filter((part) => part.length > 0)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PartyRequestSections
        party={party}
        year={year}
        householdCmId={householdCmId}
        sessionType={sessionType}
      />

      {/* kindred#2073. NOT wrapped in a `Section`: it is a sidebar CARD with
          its own forest band, the same shape `camper/CampJourneyTimeline`
          takes on the camper page, and a `Section` heading above it would
          title the card twice.

          The panel is the right host for the same reason `HousingNeedDetails`
          lives here rather than on a roster row: it shows ONE household at a
          time, which is what makes a fetch on mount proportionate. A
          person-grain party has no household, and the card renders nothing
          and fetches nothing for it. */}
      <HouseholdJourneyCard
        householdCmId={householdCmId > 0 ? householdCmId : null}
        currentYear={year}
      />

      {/* Adult weekend guests: a person-grain guest gets their own
          per-person journey — the same feed and card as the camper record. */}
      {!isHousehold && (party.person_cm_id ?? 0) > 0 && (
        <PersonJourneyCard personCmId={party.person_cm_id as number} year={year} />
      )}
    </div>
  )

  return (
    <SlideInPanel
      identity={partyKey(party)}
      title={
        !isHousehold && (party.person_cm_id ?? 0) > 0 ? (
          // kindred#2329's pattern: a NEW TAB with this board's year, and no
          // onClose — the reader keeps their place on the board.
          <Link
            to={`/camper/${String(party.person_cm_id)}?year=${String(year)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {identityLabel}
          </Link>
        ) : (
          identityLabel
        )
      }
      subtitle={isHousehold ? 'Household' : 'Adult weekend guest'}
      ariaLabel={`${identityLabel} details`}
      requestClose={requestClose}
      onClose={onClose}
      backdropInteractive={backdropInteractive}
    >
      {body}
    </SlideInPanel>
  )
}
