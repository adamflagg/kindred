/**
 * The board's atom: a household party of mixed ages.
 *
 * NOT a camper. The summer board's `CamperCard` sits inside a tall bunk column
 * beside 10–14 siblings-in-cabin; this sits alone, or beside one other party,
 * in a room. The topology differs as much as the domain does, which is why
 * this is a new component rather than a branch inside the 849-line
 * `BunkingBoardByArea.tsx`.
 *
 * ## Three things stay OFF this card (spec §3.8), each measured
 *
 * - **Request text.** 12 of 232 request texts contain health vocabulary
 *   including a named diagnosis. HANDOFF §8 accepted that exposure on the
 *   roster, where you open ONE row to read ONE household; printing it across
 *   62 simultaneously-visible cards is a materially louder exposure than that
 *   decision covered. It lives on `FamilyDetailsPanel`, one click away —
 *   which is what makes this a deferral rather than a loss.
 * - **The medical affordance.** `has_medical_narrative` was true for 62 of 62
 *   parties. A flag that is always on is not a flag — kindred#1889 agreed and
 *   deleted it; the narrative itself lives on `FamilyDetailsPanel`.
 * - **`needs_resolution`.** True for 44 of 62. Same reason.
 *
 * `FamilyCard.test.tsx` pins all three as ABSENCES, because each is exactly
 * the kind of thing a later session adds back helpfully.
 *
 * What IS here: the children lead, bold, with truncated whole-year ages —
 * ages are the entire point of a "similar ages" match — the party size, the
 * attending adults one line down in grey with last year's cabin right-anchored
 * opposite them, and the housing chips the fit check actually judges.
 *
 * ## Last year's cabin shares line 2; it does not get one (kindred#2075)
 *
 * "Returning" is only half the fact staff act on — WHERE they stayed last year
 * is what decides whether to repeat it. Summer already ships exactly this
 * treatment (`CamperCard.tsx` right-anchors `historyDisplay` on its line 2
 * beside Age/Grade), so under CLAUDE.md §4 that is the template and a third
 * content line is the divergence. DIRECTLY PRIOR YEAR ONLY: no multi-year
 * count, no "+2" affordance. A family placed two years ago but not last year
 * shows nothing here, and so does a first-timer — `FamilyCard.test.tsx` pins
 * both, because a helpful placeholder or an em dash would read as "nobody
 * assigned them" on the 202 of 459 households where the answer is simply that
 * we do not know.
 *
 * ## The household salutation is gone, not demoted (kindred#2074)
 *
 * The bold line used to be `party.display_name`, which is CampMinder's
 * `mailing_title` -- a postal salutation, not a party manifest. Measured
 * against 2026's 382 rostered households, it disagreed with the actual adult
 * list on 26.7%, in both directions: naming an adult who wasn't attending,
 * and naming only one adult when two were. A two-directional failure can't
 * be repaired inside the string, so it was deleted rather than sanitised —
 * see the issue for the full accounting. This only applies to household-grain
 * parties: a person-grain party (an adult weekend guest) IS the identity, so
 * its `display_name` stays.
 */
import { useDraggable } from '@dnd-kit/core'
import { Home, Repeat, Star, Users, type LucideIcon } from 'lucide-react'
import { Fragment } from 'react'

import type { LodgingUnitRow, PartyChildRow, RosterPartyRow } from '../../types/lodging'
import { displayCampMinderAge, displayTruncatedAge } from '../../utils/age'
import { Tooltip } from '../ui/Tooltip'
import { answersConflictDetail, SHARE_WORDING, shareWordingChip } from './boardLayout'
import {
  attendingAdults as computeAttendingAdults,
  dedupeAdultNames,
  dedupeChildNames,
  partyHeadcount,
} from './householdIdentity'
import { partyKey } from './partyKey'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'

export interface FamilyCardProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined while unplaced. */
  unit?: LodgingUnitRow | undefined
  /**
   * Whether another party is in the same room. Declining to share is the
   * ordinary answer and contradicts nothing on its own — it only becomes
   * worth saying when somebody else is in the room (spec §11).
   */
  sharedSlot?: boolean
  /**
   * Whether this PLACEMENT — this party's own occupied leaves, not the
   * card it happens to share — covers an entire building (kindred#2008).
   * A household holding a whole building is private in a way no
   * combination of room-level flags conveys; the caller computes this from
   * `boardLayout.ts`'s `wholeBuildingHolders`, never re-derived here.
   */
  holdsWholeBuilding?: boolean
  /**
   * The card is in the unplaced queue rather than in a slot on the board.
   * Purely a surface choice: the popover's own background is already the
   * page's, so a card inside it needs `bg-card` to read as a card at all,
   * where one sitting in a slot needs `bg-background` to read as distinct
   * from the slot around it.
   */
  inQueue?: boolean
  /**
   * Whether this card can be picked up — true only inside a scenario, for a
   * user holding `bunking.manage`. See `LodgingBoard`.
   *
   * The drag id is derived here rather than passed in, so it cannot disagree
   * with the id `resolveDrop` looks the party back up by.
   */
  isDraggable?: boolean
  onOpen: (party: RosterPartyRow) => void
}

type ChipTone = 'need' | 'warn' | 'share' | 'quiet' | 'muted' | 'building'

const CHIP_TONE: Record<ChipTone, string> = {
  need: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  warn: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  share: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  quiet: 'border-border text-muted-foreground border border-dashed',
  muted: 'bg-muted text-muted-foreground',
  // Distinct from `share` (a REQUEST) and `warn` (a problem) — a whole
  // building held is neither, it is a privacy fact staff act on. Distinct
  // from `unitBadges.ts`'s violet "Staff" badge too, so the two never read
  // as the same signal on adjoining cards.
  building: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300',
}

function Chip({
  label,
  tone,
  icon: Icon,
  title,
}: {
  label: string
  tone: ChipTone
  /** Optional, e.g. the "Whole building" chip's `Home` — every other chip omits it. */
  icon?: LucideIcon
  /**
   * The chip's per-party detail, e.g. "Answers disagree"'s account of which
   * two answers disagreed (kindred#2083).
   *
   * ## Now a real `ui/Tooltip` trigger, not `sr-only` text (kindred#2250)
   *
   * kindred#2177 replaced the board's `title` attributes with a focusable
   * tooltip everywhere except here: THE WHOLE CARD WAS A `<button>` at the
   * time, and a `<button>`'s content model forbids interactive descendants
   * — a nested trigger would have been invalid HTML and its tap would have
   * bubbled straight into `onOpen`, opening the details panel instead of
   * the bubble. `HouseholdRosterRow`'s in-button badges hit the identical
   * wall and took the identical `sr-only` way out.
   *
   * kindred#2222 removed that wall — `FamilyCard`'s frame is a `<div>` now,
   * and this chip row is a SIBLING of the card's open control, not its
   * child — but left the trigger unwired. A real staff member could not
   * read a real answer-conflict explanation because it was parked in
   * `sr-only` text nothing on this desktop-only board ever announces
   * (kindred#2250's field report). Same trigger primitive as
   * `SharePreferenceChip`, the other chip on this surface with a per-party
   * detail behind it: `Tooltip` when there's a `title` to show, a plain
   * `<span>` when there isn't, so a chip with nothing to explain never
   * becomes a dead stop in the tab order.
   */
  title?: string
}) {
  const chipClassName = `inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP_TONE[tone]}`
  const content = (
    <>
      {Icon && <Icon className="mr-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />}
      {label}
    </>
  )
  if (title !== undefined && title.length > 0) {
    return (
      <Tooltip content={title} className={chipClassName}>
        {content}
      </Tooltip>
    )
  }
  return <span className={chipClassName}>{content}</span>
}

/**
 * Youngest-first display order for one party's children (kindred#2254).
 *
 * A COPY, never the input array sorted in place: `party.children` is the
 * frontend's own copy of the server's `_children_oldest_first` — the order
 * `lodging_roster_service.py` computes once and every surface prints in —
 * and `FamilyCardIdentity` reads it twice (this component is rendered for
 * both the bold and grey lines from the SAME `children` array). Sorting in
 * place on the first render would leave the second render, and any sibling
 * component still holding that reference, reading an order nobody asked it
 * to have.
 *
 * Unknown age (`null` — this field's already-converted form of the raw
 * `0.0` sentinel the API collapses before the wire, kindred#2088) is not a
 * fact about how young a child is, so it cannot take part in the
 * comparison at all. A comparator naive enough to do
 * `(a.age ?? 0) - (b.age ?? 0)` coerces it to 0 and sorts it FIRST under an
 * ascending youngest-first order — the exact opposite of the intent, and
 * wrong in a way that looks right. Unknown-age children go in their own
 * trailing bucket instead, in their original relative order (`Array.sort`
 * is stable, so ties within the known-age bucket keep theirs too) — the
 * same place the server's own descending sort already puts them, since its
 * raw-float sentinel sorts last there too.
 */
function youngestFirst(children: readonly PartyChildRow[]): PartyChildRow[] {
  const known: PartyChildRow[] = []
  const unknown: PartyChildRow[] = []
  for (const child of children) {
    ;(child.age === null || child.age === undefined ? unknown : known).push(child)
  }
  known.sort((a, b) => (a.age as number) - (b.age as number))
  return [...known, ...unknown]
}

/**
 * A party's children as one `Name (age) · Name (age)` run, youngest first.
 *
 * `FamilyCardIdentity` renders a child list TWICE — the household bold
 * identity line and the person-grain grey secondary line — and the two
 * differ only in which age formatter they call and what wraps them.
 * Everything else (the ordering, the key strategy, the separator, the
 * missing-age omission, the blank-name fallback) is one decision each, and
 * each was drifting toward being made in two places: the blank-name
 * fallback had to be hand-applied to both copies in kindred#2074. Shared
 * for the same reason `FamilyCardPreview` shares
 * `FamilyCardIdentity`/`FamilyCardChips` (kindred#2222, formerly one
 * `FamilyCardBody`) — so the copies cannot drift apart (kindred#2153).
 *
 * The caller supplies the wrapper, because the two sites want different ones:
 * the bold line's span is also the non-household branch's, and the grey line's
 * exists only when there are children to put in it.
 *
 * Youngest child leads because that is the one housing decisions turn on —
 * crib, ground floor, proximity (kindred#2254's field report). This also
 * decides which children the CSS `truncate` on the bold line clips away on
 * a large family: the OLDEST now vanish first, the reverse of before. That
 * is the deliberate trade the ordering makes, not an accident of it.
 *
 * A surname every child shares is lifted off the individual names and
 * printed ONCE, after the run — `Ava (5) · Noah (8) Johnson` (kindred#2180).
 * The derivation is `dedupeChildNames`, which reads the structured
 * `last_name` the API sends rather than splitting `display_name`: 4.7% of
 * 2026's rostered children have a surname containing a space and 10.6% a
 * hyphenated one, and both break under a token split. Nothing is lifted
 * unless every child shares it, so a two-surname household still prints in
 * full. Fed the ALREADY-SORTED order below, not the raw prop, so the names
 * returned line up index-for-index with what actually renders.
 *
 * @param formatAge - `displayTruncatedAge` on the bold line (whole years are
 *   the point of a similar-ages match), `displayCampMinderAge` on the grey one.
 */
function ChildList({
  children,
  formatAge,
}: {
  children: PartyChildRow[]
  formatAge: (age: number) => string
}) {
  const ordered = youngestFirst(children)
  const { names, sharedSurname } = dedupeChildNames(ordered)
  return (
    <>
      {ordered.map((child, index) => (
        <Fragment key={String(child.person_cm_id ?? index)}>
          {index > 0 && ' · '}
          {/* An age we do not have is omitted, never rendered as 0.
              A blank name (no first/preferred/last name on file --
              `_person_display_name` has no fallback the way
              `_household_display_name` does) falls back rather than
              leaving this segment, or the whole card when it's the
              only child, with no accessible text at all. */}
          <span>
            {child.age === null || child.age === undefined
              ? names[index] || 'Unnamed camper'
              : `${names[index] || 'Unnamed camper'} (${formatAge(child.age)})`}
          </span>
        </Fragment>
      ))}
      {sharedSurname.length > 0 && ` ${sharedSurname}`}
    </>
  )
}

/**
 * Lines 1–2: the household's identity, headcount and last year's cabin.
 *
 * Split out of what used to be one `FamilyCardBody` so `FamilyCard` can put
 * ONLY this half inside its real, focusable `<button>` (kindred#2222).
 * `FamilyCardChips` (below) sits beside it as a SIBLING rather than a child,
 * on purpose: a `<button>`'s content model forbids an interactive
 * descendant, and the chip row is exactly where kindred#2177 left a
 * `sr-only` detail sentence waiting for a real tooltip trigger
 * (kindred#2250). Swapping the card's outer frame to a `<div>` while still
 * wrapping the WHOLE body in one inner `<button>` would just move that wall
 * one level deeper — nothing would actually be unblocked. Keeping the chip
 * row OUT of the button is what does.
 */
function FamilyCardIdentity({ party }: { party: RosterPartyRow }) {
  const children = party.children ?? []
  const isHousehold = party.grain === 'household'
  // The filter itself -- family_camp_adults stores adult slots 1-5 as
  // separate rows per household, and a slot with no name on file is not an
  // attending adult, CampMinder leaves it blank rather than omitting the
  // row -- lives in `householdIdentity.ts`, shared with the four non-card
  // surfaces that replaced the salutation with this same list (kindred#2084).
  const attendingAdults = computeAttendingAdults(party)
  const { names: adultNames, sharedSurname: sharedAdultSurname } = dedupeAdultNames(attendingAdults)
  // Last year's cabin, right-anchored on the grey line below (kindred#2075).
  //
  // Trimmed here rather than trusted: '' is the common case (202 of 2026's 459
  // registered households) and a whitespace-only string must read as the same
  // absence, not as an empty right-anchored gap. Read ONLY inside the
  // household branch below, which is the grain gate — no second one here,
  // because a redundant `isHousehold` guard would look like the load-bearing
  // one and outlive the branch it duplicates.
  const lastYearCabin = (party.last_year_cabin ?? '').trim()

  return (
    <>
      <span className="flex items-baseline gap-1.5">
        <span
          data-testid="family-card-name"
          // `min-w-0 flex-1 truncate` matches summer's CamperCard.tsx, whose
          // equivalent identity line needs it for the same reason: an
          // unbounded name (here, a multi-child concatenation) sits in a flex
          // row against the party-size badge at the end and would otherwise
          // squeeze it rather than wrap or clip.
          className="text-foreground min-w-0 flex-1 truncate text-sm leading-tight font-semibold"
        >
          {isHousehold ? (
            <ChildList children={children} formatAge={displayTruncatedAge} />
          ) : (
            party.display_name
          )}
        </span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-0.5 text-xs tabular-nums">
          <Users className="h-3 w-3 flex-shrink-0" />
          {/* `party.party_size` is a BED count since kindred#1925/#2046 (it
              drops blank/placeholder adult slots and discounts an infant),
              which can legitimately disagree with the names printed below --
              `partyHeadcount` is that printed count, so the badge can never
              disagree with its own card (kindred#2152). */}
          {partyHeadcount(party)}
        </span>
      </span>

      {/* LINE 2, and it holds TWO things now (kindred#2075): the attending
          adults on the left, last year's cabin right-anchored at the end.
          Summer does exactly this at `CamperCard.tsx`'s line 2, where
          `historyDisplay` sits opposite Age/Grade — under CLAUDE.md §4 that
          made it the template rather than one option among two, and the
          alternative (a third content line) the divergence.

          The one place weekend cannot copy summer outright: summer's left
          half is a fixed-width "Age 9.42 · 4th", where this one is
          variable-length adult names, and the card is ~244 px wide inside
          `LodgingUnitCard` (its `p-4` + `border-2` eat 36 px off the board's
          `minmax(280px,1fr)` column). So they genuinely compete for the row,
          and THE ADULT NAMES GIVE WAY: the cabin string is the new
          information and the reason the line exists.

          The budget, measured on 2022-2025's 1,786 placed registrations so
          the next person does not have to: the cabin string runs 7-34
          characters, p50 11 and p95 30. At `text-xs` even the longest fits
          the ~220 px of card content, which is why the row carries no
          `overflow-hidden` — clipping would eat the room number off the END
          of the string, and there is nothing to clip.

          HOUSEHOLD GRAIN ONLY, and this `isHousehold` branch is the whole
          gate — the same one the "Returning" badge below uses, for the same
          reason. The server keys the cabin off a household cm_id, so a
          person-grain adult weekend guest has none to have, and the other
          branch has no grey line to hang it on. */}
      {isHousehold
        ? (attendingAdults.length > 0 || lastYearCabin.length > 0) && (
            <span className="flex items-baseline gap-2">
              {attendingAdults.length > 0 && (
                <span
                  data-testid="family-card-adults"
                  // `min-w-0` is not decoration: without it a flex child
                  // refuses to shrink below its content width and `truncate`
                  // never fires, leaving the cabin pushed off the card.
                  //
                  // Truncated even when no cabin sits beside it, so line 2 is
                  // ONE line on every card. The bold identity line above
                  // already truncates for the same reason, and a four-adult
                  // household that wraps here pushes the chip row down and
                  // grows the card — the density problem this card fights
                  // everywhere else. The full list is one click away in
                  // `FamilyDetailsPanel`.
                  className="text-muted-foreground min-w-0 flex-1 truncate text-xs leading-snug"
                >
                  {/* A surname every adult shares is printed once at the end of
                  the line, the same shape as the children's run above
                  (kindred#2180) -- but on a weaker signal, and deliberately
                  not the same rule: `family_camp_adults.last_name` is empty
                  on every 2026 row, so `dedupeAdultNames` can only compare
                  the trailing token of a free-text name. It fires on 135 of
                  the 340 multi-adult rostered households and leaves the other
                  205 written out in full. The adults are the FILTERED list,
                  so a placeholder slot cannot suppress the dedupe. */}
                  {adultNames.map((name, index) => (
                    <Fragment key={String(attendingAdults[index]?.adult_number ?? index)}>
                      {index > 0 && ' · '}
                      <span>{name}</span>
                    </Fragment>
                  ))}
                  {sharedAdultSurname.length > 0 && ` ${sharedAdultSurname}`}
                </span>
              )}
              {/* The staff-written string out of last year's registration,
                  verbatim — never resolved against the unit registry, so it
                  can legitimately name something no card on the board is
                  called (see the schema field). `ml-auto` right-anchors it
                  whether or not adults sit beside it: a household with no
                  attending adult has no grey line for the cabin to join, and
                  the cabin is real data that is not dropped to preserve a
                  line that was never there.

                  RARE, and deliberately not quantified off the `name` column
                  alone — 63 of 2026's 459 registered households have a blank
                  `family_camp_adults.name`, but `_adult_display_name`'s
                  first_name/last_name fallback is load-bearing and rescues
                  most of them, so the figure `computeAttendingAdults`
                  actually produces is 35 of 459 registered and ONE of the
                  382 rostered households this card renders. The branch earns
                  its place on that one card, not on 63. */}
              {lastYearCabin.length > 0 && (
                <span
                  data-testid="family-card-last-year-cabin"
                  className="text-muted-foreground ml-auto flex-shrink-0 text-xs leading-snug whitespace-nowrap"
                >
                  {lastYearCabin}
                </span>
              )}
            </span>
          )
        : // Person-grain (adult weekend) parties are a single guest identified
          // by the bold line above, not a household -- so there is no separate
          // adult list. The old children-with-CampMinder-age line stays for the
          // rare person-grain party that carries children of its own.
          children.length > 0 && (
            <span className="text-muted-foreground text-xs leading-snug">
              <ChildList children={children} formatAge={displayCampMinderAge} />
            </span>
          )}
    </>
  )
}

/**
 * Line 3: the chip row — housing flags, the fit verdict, share-request
 * chips, and the Returning/First-time badges.
 *
 * A SIBLING of `FamilyCardIdentity`'s `<button>` (kindred#2222), never its
 * child — see that component's doc for why. The one chip carrying a `title`
 * today (`Chip`'s "Answers disagree" detail, kindred#2083) is a real
 * `ui/Tooltip` trigger now, not `sr-only` text (kindred#2250) — the sibling
 * relationship this refactor set up is what makes that trigger valid HTML
 * here at all.
 */
function FamilyCardChips({
  party,
  unit,
  sharedSlot,
  holdsWholeBuilding = false,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot: boolean
  holdsWholeBuilding?: boolean
}) {
  const flags = party.flags ?? {}
  const isHousehold = party.grain === 'household'
  const attention = partyAttention(party, unit)
  const proximity = party.share?.proximity ?? []
  // `similar_ages` ACCOMPANIES `with`; it never replaces it. One chip covering
  // both is what keeps 22 households from dropping out of a "wants to share"
  // view — a chip showing one *or* the other loses them.
  const wantsToShare = proximity.includes('with') || proximity.includes('similar_ages')
  const wantsNear = proximity.includes('near')
  const conflictDetail = answersConflictDetail(party.share)

  return (
    <span className="flex flex-wrap gap-1">
      {/* #2008: this PLACEMENT covers every leaf of a building, not merely
            a card it happens to share — see `holdsWholeBuilding`'s doc.
            First in the row: it is a fact about the household's privacy, not
            a need or a warning, and staff scan left-to-right. */}
      {holdsWholeBuilding && <Chip label="Whole building" tone="building" icon={Home} />}
      {/* The needs a cabin field can actually answer — the same two the fit
            check judges. `needs_accommodation` names no specific amenity, so
            it is carried by the verdict chip below instead of duplicated. */}
      {flags.needs_private_bathroom === true && <Chip label="Private bathroom" tone="need" />}
      {flags.needs_power === true && <Chip label="Power" tone="need" />}

      {attention.level === 'required' && <Chip label={ATTENTION_LABEL.required} tone="warn" />}
      {attention.level === 'unmet' && <Chip label={attention.reason} tone="warn" />}
      {attention.level === 'unverified' && <Chip label={ATTENTION_LABEL.unverified} tone="quiet" />}

      {/* Keyed off the RESOLVED verdict, not the registration gate. The gate
            is superseded wherever the Family Camp form answered, so a household
            that said no at registration and then named a partner is legitimately
            placed — chipping it "declined" repeats at card level exactly the
            false positive the slot flag was moved off the gate to avoid.
            Wording matches the slot: the form has no refusal option. */}
      {sharedSlot && party.share?.eligibility === 'declined' && (
        <Chip label={shareWordingChip(SHARE_WORDING.declined)} tone="warn" />
      )}
      {/* 16 households for 2026 carry disagreeing answers. Shown on the card
            as well as the slot, so a party sitting alone still surfaces one.
            Gated on the DETAIL, not the raw boolean (kindred#2083): a party
            this can't explain — none exist today, but a person-grain party
            carries no share block to begin with — never renders an empty
            chip. The tooltip names which two answers disagreed and which one
            staff are acting on, matching `SharePreferenceChip`'s hover
            pattern rather than a bare unexplained flag. */}
      {conflictDetail !== null && (
        <Chip label={shareWordingChip(SHARE_WORDING.conflict)} tone="warn" title={conflictDetail} />
      )}
      {wantsToShare && <Chip label="Wants to share" tone="share" />}
      {/* NEAR and WITH are different requests: NEAR is satisfied by map
            distance between units, WITH by putting both in one room. */}
      {wantsNear && <Chip label="Near another family" tone="muted" />}

      {party.is_returning === true && (
        <span className="text-forest-700 dark:text-forest-300 inline-flex items-center gap-0.5 text-xs font-semibold">
          <Repeat className="h-2.5 w-2.5 flex-shrink-0" />
          Returning
        </span>
      )}
      {/* `is_returning` is only ever computed for household-grain parties
            (`_build_household_parties` sets it from `prior_cm_ids`). An
            adult weekend guest is `grain: 'person'`, for which the field is
            never set and arrives as the Pydantic default `false` -- untracked,
            not "no". Gating on grain keeps this badge from calling every
            adult weekend regular a first-timer. */}
      {isHousehold && party.is_returning !== true && (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
          <Star className="h-2.5 w-2.5 flex-shrink-0" />
          First-time
        </span>
      )}
    </span>
  )
}

/**
 * The card's own frame, shared by the real card and the drag overlay.
 *
 * `rounded-xl border-2 p-2.5` is `CamperCard`'s geometry exactly (CLAUDE.md
 * §4). At `rounded-lg`, a 1px border and `px-2 py-1.5` this read as a table
 * row sitting inside a card -- the same criticism that opened this whole
 * exercise, one level down.
 *
 * `overflow-hidden` is deliberately NOT copied across. `CamperCard` needs it
 * to clip an absolutely-positioned gradient at its foot; this card has no such
 * element, so the class would be cargo.
 */
const CARD_FRAME =
  'group border-border flex w-full flex-col gap-1 rounded-xl border-2 p-2.5 text-left'

export function FamilyCard({
  party,
  unit,
  sharedSlot = false,
  holdsWholeBuilding = false,
  inQueue = false,
  isDraggable = false,
  onOpen,
}: FamilyCardProps) {
  // `disabled` does NOT prevent registration — dnd-kit registers the node in
  // `draggableNodes` unconditionally and `disabled` only nulls the listeners
  // (verified in @dnd-kit/core 6.3.1). What gates the interaction is the
  // conditional spread below, which four tests pin. `disabled` is kept for
  // the `aria-disabled` it sets and as a second refusal to hand back
  // listeners.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: partyKey(party),
    disabled: !isDraggable,
  })

  return (
    // NOT a `<button>` (kindred#2222) — a `<div>` frame, so the chip row
    // below can host a real interactive trigger (kindred#2250) as a SIBLING
    // instead of a forbidden nested descendant.
    //
    // `ref`/`listeners` stay HERE, not on the inner control below: dnd-kit's
    // `listeners` is pointer/keyboard event handlers, not ARIA, so keeping
    // them on the full frame is what lets a drag still start from ANYWHERE
    // on the card, matching today's behaviour exactly — `onPointerDown`
    // fired on the inner button still bubbles up here regardless. What must
    // NOT land here is `attributes`: it carries `role: 'button'` +
    // `tabIndex: 0` UNCONDITIONALLY (`useDraggable`'s own doc), and spreading
    // it onto this `<div>` would silently recreate
    // `<div role="button" tabindex="0">` — still an ARIA button, the exact
    // defect this refactor exists to remove. `attributes` moves to the
    // explicit inner control below instead.
    <div
      data-family-card
      ref={setNodeRef}
      {...(isDraggable ? listeners : {})}
      className={`${CARD_FRAME} hover:border-primary/50 transition-colors ${
        inQueue ? 'bg-card' : 'bg-background'
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
        // The card stays mounted and dimmed rather than being removed: the
        // grid would reflow under the pointer mid-drag, moving every other
        // drop target out from under it.
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {/* THE EXPLICIT INNER CONTROL (kindred#2222). Carries click, keyboard
          activation (native `<button>` semantics) and the focus ring — the
          same three the old single `<button>` carried, just narrowed to the
          identity lines rather than the whole card. `attributes` lands here,
          not on the frame above: a native `<button>` is already
          `role="button"` and already `tabIndex 0`, so dnd-kit's values are
          redundant-but-harmless here, where on the frame they would be the
          defect. */}
      <button
        type="button"
        {...(isDraggable ? attributes : {})}
        onClick={() => {
          onOpen(party)
        }}
        className="focus-visible:ring-ring flex w-full flex-col gap-1 rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <FamilyCardIdentity party={party} />
      </button>
      <FamilyCardChips
        party={party}
        unit={unit}
        sharedSlot={sharedSlot}
        holdsWholeBuilding={holdsWholeBuilding}
      />
    </div>
  )
}

/**
 * The card as it appears under the pointer, inside `<DragOverlay>`.
 *
 * IT MUST NOT CALL `useDraggable`, and that is the whole reason it exists.
 * dnd-kit registers a draggable node unconditionally — `disabled` does not
 * stop it — so rendering a real `FamilyCard` here would register a SECOND
 * draggable under the same `partyKey`, overwrite the source card's entry in
 * `draggableNodes`, and then delete that entry outright when the overlay
 * unmounts. The card the staff member just dropped would be gone from the
 * registry, and its own effect never re-fires.
 *
 * Summer reached the same conclusion first and hand-rolls plain markup in its
 * DragOverlay (`BunkingBoardByArea.tsx:662-702`) rather than reusing its
 * draggable `CamperCard`. This shares the body instead of copying it, so the
 * overlay cannot drift away from the card it represents.
 */
export function FamilyCardPreview({
  party,
  unit,
  sharedSlot = false,
  holdsWholeBuilding = false,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot?: boolean
  holdsWholeBuilding?: boolean
}) {
  return (
    <div className={`${CARD_FRAME} bg-card shadow-lodge-lg border-primary/50 rotate-2`}>
      <FamilyCardIdentity party={party} />
      <FamilyCardChips
        party={party}
        unit={unit}
        sharedSlot={sharedSlot}
        holdsWholeBuilding={holdsWholeBuilding}
      />
    </div>
  )
}
