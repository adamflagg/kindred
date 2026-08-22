/**
 * The board's atom: a household party of mixed ages.
 *
 * NOT a camper. The summer board's `CamperCard` sits inside a tall bunk column
 * beside 10–14 siblings-in-cabin; this sits alone, or beside one other party,
 * in a room. The topology differs as much as the domain does, which is why
 * this is a new component rather than a branch inside the 849-line
 * `BunkingBoardByArea.tsx`.
 *
 * ## Four things stay OFF this card, each measured
 *
 * Recorded in `docs/reference/weekend-card-vocabulary.md` §3. That citation
 * used to read "spec §3.8", pointing at
 * `docs/superpowers/specs/2026-07-31-family-camp-lodging-board-map-design.md`,
 * which is GITIGNORED and exists in nobody's clone — one of at least nine
 * such citations in shipped code, and the reason the tracked doc exists.
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
 * - **The `Needs Accommodation` chip, and any VIP-opt-out mark beside it.**
 *   Staff ruling: the accommodation/VIP signal (the raw `accommodation_is_
 *   mandatory` / `opt_out_vip` pair, kindred#1874) is a request the household
 *   made, not a verdict about whether this card belongs in its slot — that
 *   verdict is `rosterAttention`'s and stays exactly where it was, on the
 *   roster tab's attention sections and the modal's Placement verdict. This
 *   card no longer imports `partyAttention` or `ATTENTION_LABEL` at all.
 *   `AccessibilityFlagList` on `FamilyDetailsPanel` is the one place either
 *   raw answer is visible now, and it renders BOTH states — the existing
 *   mandatory row plus a new flexible-on-cabin-type row for `opt_out_vip`.
 *
 * `FamilyCard.test.tsx` pins all four as ABSENCES, because each is exactly
 * the kind of thing a later session adds back helpfully.
 *
 * What IS here: the children lead, bold, with truncated whole-year ages —
 * ages are the entire point of a "similar ages" match — the party size, the
 * attending adults one line down in grey with last year's cabin right-anchored
 * opposite them, and a third line carrying the household's needs and
 * intentions.
 *
 * ## The third line is a GLYPH ROW now (kindred#2072)
 *
 * It used to be words: `Private bathroom`, `Power`, `No power`, `Fit not
 * verified`, `Whole building`, `Single parent`, `Returning`. Seven possible
 * chips, of which the pair that fires on nearly every card (Returning /
 * First-time, 279 against 123) took two of the widest slots to say something
 * staff read at a glance.
 *
 * Now: the four ruled needs — bathroom, power, fridge, step-free — as
 * icon-only chips in a closed hue set, red-filled when the room does not meet
 * them (N2); the sharing intentions still as words, because they are the
 * marks staff have not yet ruled on; the single-parent mark moved UP to line 2
 * where it describes the adult beside it (S2 + Sa); and Returning/First-time
 * as one 16px icon pinned bottom-right (R3).
 *
 * A need the household did not ask for is OMITTED, never dimmed. Every mark,
 * every cut and the reason for each is in
 * `docs/reference/weekend-card-vocabulary.md` — read §3 before adding
 * anything here, because seven marks were removed on purpose.
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
import {
  useDraggable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import { Repeat, Star, User, Users } from 'lucide-react'
import { Fragment, memo } from 'react'

import type { LodgingUnitRow, PartyChildRow, RosterPartyRow } from '../../types/lodging'
import { displayCampMinderAge, displayTruncatedAge } from '../../utils/age'
import { Tooltip } from '../ui/Tooltip'
import { answersConflictDetail, SHARE_WORDING, shareWordingChip } from './boardLayout'
import {
  attendingAdults as computeAttendingAdults,
  childrenRun,
  dedupeAdultNames,
  partyHeadcount,
} from './householdIdentity'
import { NeedGlyphMark, WARN_TONE } from './NeedGlyph'
import { resolveNeedGlyphs } from './needGlyphs'
import { partyKey } from './partyKey'

export interface FamilyCardProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined while unplaced. */
  unit?: LodgingUnitRow | undefined
  /**
   * Whether another party is in the same room. Declining to share is the
   * ordinary answer and contradicts nothing on its own — it only becomes
   * worth saying when somebody else is in the room
   * (`docs/reference/weekend-card-vocabulary.md` §2, the sharing-intent
   * chips — a gitignored "spec §11" until kindred#2072).
   */
  sharedSlot?: boolean
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

/**
 * ⚠️ THREE TONES WERE REMOVED WITH THEIR CHIPS (kindred#2072) AND MUST NOT
 * COME BACK AS DECORATION:
 *
 *   `need`     — the amber fill of `Private bathroom` / `Power`. Those two
 *                chips ARE the need glyphs now.
 *   `quiet`    — the dashed `Fit not verified` chip, struck with both arms of
 *                `Reconfirm amenities` (vocabulary §3).
 *   `building` — the indigo `Whole building` chip, an earlier cut that had
 *                never been landed. It survives on the MAP, which keeps its
 *                own copy in `MapUnitPopover`.
 *
 * A tone with no chip is an invitation to invent one.
 *
 * `warn` is imported rather than spelled out, because the GLYPH defines that
 * ink and this merely borrows it: the glyph replaced the `No power` chip that
 * used to sit beside it, and two reds for one meaning is how a palette stops
 * meaning anything.
 */
type ChipTone = 'warn' | 'share' | 'muted'

const CHIP_TONE: Record<ChipTone, string> = {
  warn: WARN_TONE,
  share: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  muted: 'bg-muted text-muted-foreground',
}

function Chip({
  label,
  tone,
  title,
}: {
  label: string
  tone: ChipTone
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
  // No icon slot. The one chip that carried one ("Whole building", a `Home`)
  // is struck; every need that wants an icon is a glyph now, and a word chip
  // that grows one would be the two vocabularies collapsing back together.
  const content = label
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
 * A party's children as one `Name (age) · Name (age)` run, youngest first.
 *
 * ⚠️ THE DERIVATION ITSELF NOW LIVES IN `householdIdentity.ts`
 * (`childrenRun`), and this component is only its markup. It moved there
 * when the owner ruled 2026-08-20 that the Assign modal's candidate rows
 * print the SAME identity (kindred#2072 §3.5) — two surfaces, one rule.
 *
 * The reasoning that put the derivation in one place is unchanged and still
 * the point, so it is repeated at neither site and stated at `childrenRun`:
 * the ordering, the unknown-age bucket, the omitted age, the blank-name
 * fallback and the lifted surname were each drifting toward being decided
 * twice. The blank-name fallback already HAD to be hand-applied to both
 * copies once (kindred#2074).
 *
 * `FamilyCardIdentity` still renders a child list TWICE — the household bold
 * identity line and the person-grain grey secondary line — and the two still
 * differ only in which age formatter they call and what wraps them. Shared
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
  const { segments, sharedSurname } = childrenRun(children, formatAge)
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 && ' · '}
          <span>{segment.text}</span>
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
  // Last year's cabin, right-anchored on the grey line below (kindred#2075),
  // resolved to the current registry name by kindred#2332.
  //
  // ⚠ A YEAR'S HOUSING, NOT A WEEKEND'S (kindred#2336). `cabin_assignment` has
  // grain (household, year) because its CampMinder source is one household
  // custom field per season, so a household attending two weekends carries one
  // cabin for both. Staff accepted that 2026-08-15. Never read this as "where
  // they slept on THIS weekend last year".
  //
  // Trimmed here rather than trusted: '' is the common case (202 of 2026's 459
  // registered households) and a whitespace-only string must read as the same
  // absence, not as an empty right-anchored gap. Read ONLY inside the
  // household branch below, which is the grain gate — no second one here,
  // because a redundant `isHousehold` guard would look like the load-bearing
  // one and outlive the branch it duplicates.
  const lastYearCabin = (party.last_year_cabin ?? '').trim()
  /*
   * S2 + Sa (kindred#2072): the single-parent mark LEFT the chip row.
   *
   * It sat there wearing the muted `Near another family` grammar, which made
   * a fact about who is in the room read as a preference the household
   * expressed. On line 2, immediately before the adult it describes, it reads
   * as what it is. Freeing that chip slot also un-wrapped the densest cards.
   *
   * Derived from the ATTENDING adult list, never `party.adults.length` or
   * `party_size` — both count listed-but-not-attending adults
   * (kindred#1925/#2046) and would false-positive a two-parent household
   * where one adult never RSVP'd for this session. `computeAttendingAdults`
   * already grain-gates, so no separate household check is needed.
   */
  const isSingleParent = attendingAdults.length === 1

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
                  {/* ⚠️ INLINE, INSIDE THE NAMES — not a flex sibling of them,
                      and the difference is 2.25px of visible jitter.

                      The first version wrapped the icon and the names in a flex
                      box. An `<svg>` has NO BASELINE, so that wrapper's baseline
                      was synthesised from the icon's bottom edge, and line 2's
                      `items-baseline` then dropped the right-anchored cabin
                      2.25px below the adult names — but ONLY on the cards
                      carrying this mark, so a column of cards showed the cabin
                      jittering. Measured across 30 live cards: 2.25px with the
                      mark, 0 without.

                      Inline, the span's baseline is the text's own and the two
                      halves of line 2 sit level again. It is also what the
                      review artifact does.

                      ⚠️ SIZED AND ALIGNED TO THE CAPITAL BESIDE IT, NOT TO THE
                      LINE BOX (owner, 2026-08-20). It was `h-3 w-3` —12px —
                      hung from `align-text-bottom`, which is the DESCENDER
                      line, not the baseline. Measured in Chromium against the
                      real font: the lucide `user` glyph inks from y=2 to y=22
                      of its 24 viewBox (circle top 7−4−1, shoulder bottom
                      21+1), so that box put the head 0.75px BELOW the cap-top
                      of the S it stands before and ran 2.75px BELOW the
                      baseline. The owner read both off the screen before any
                      of this was measured.

                      `align-baseline` puts the box's bottom ON the baseline,
                      which alone stops the ink dipping under the letters at
                      any size. 9px is then the size whose ink top lands on the
                      cap: +0.50px above it, against +1.42 at 10px and +2.33 at
                      11px. The artifact's own mark is 11px at
                      `vertical-align:-1px` and measures +1.33 / −0.17; the
                      owner wanted the top ON the S, and this is nearer.

                      The jitter above stays fixed: at 9px the box sits wholly
                      inside a 16.5px line box, so it grows nothing.

                      AMBER, and specifically First-time's amber: one language
                      for "notice this household" across both marks (Sa). */}
                  {isSingleParent && (
                    <User
                      data-testid="family-card-single-parent"
                      className="mr-0.5 inline h-[9px] w-[9px] align-baseline text-amber-700 dark:text-amber-300"
                    />
                  )}
                  {adultNames.map((name, index) => (
                    <Fragment key={String(attendingAdults[index]?.adult_number ?? index)}>
                      {index > 0 && ' · '}
                      <span>{name}</span>
                    </Fragment>
                  ))}
                  {sharedAdultSurname.length > 0 && ` ${sharedAdultSurname}`}
                </span>
              )}
              {/* Last year's housing, named in TODAY's language (kindred#2332)
                  — the server resolves the staff-written string through the
                  alias layer and sends the unit's present-day registry name,
                  so this line and the board card behind it finally agree.
                  Nothing here strips or shortens it: `lodging_units.name`
                  averages 10.5 characters and tops out at 24, against a raw
                  string that reached 34. The raw string itself is provenance
                  and is NOT duplicated onto this card — it rides on the
                  journey's `cabin_name_raw`, one click away in the details
                  panel this card opens. `ml-auto` right-anchors it
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
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot: boolean
}) {
  const isHousehold = party.grain === 'household'
  const proximity = party.share?.proximity ?? []
  // `similar_ages` ACCOMPANIES `with`; it never replaces it. One chip covering
  // both is what keeps 22 households from dropping out of a "wants to share"
  // view — a chip showing one *or* the other loses them.
  const wantsToShare = proximity.includes('with') || proximity.includes('similar_ages')
  const wantsNear = proximity.includes('near')
  const conflictDetail = answersConflictDetail(party.share)
  // The four ruled needs, graded once, in `needGlyphs.ts`. A need the
  // household did not ask for is ABSENT from this array — never dimmed (§6).
  const glyphs = resolveNeedGlyphs(party, unit)

  return (
    /* `flex-nowrap` on the ROW and the wrapping confined to the group inside
       it: that is what pins the Returning/First-time mark bottom-right (R3)
       however many chips the household carries. `items-end` keeps it sitting
       on the last chip line rather than floating beside the first. */
    <span className="flex flex-nowrap items-end gap-1">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {/* Glyphs lead, in the closed set's own order, because they are the
            household's ASK and everything after them is context for it. */}
        {glyphs.map((glyph) => (
          <NeedGlyphMark key={glyph.key} glyph={glyph} />
        ))}

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
          <Chip
            label={shareWordingChip(SHARE_WORDING.conflict)}
            tone="warn"
            title={conflictDetail}
          />
        )}
        {wantsToShare && <Chip label="Wants to share" tone="share" />}
        {/* NEAR and WITH are different requests: NEAR is satisfied by map
            distance between units, WITH by putting both in one room. */}
        {wantsNear && <Chip label="Near another family" tone="muted" />}
      </span>

      {/* R3 — a 16px ICON, no text label, pinned bottom-right.
          "Returning" and "First-time" spelled out cost two of the widest chips
          on the card to say something staff read as a glance, and they said it
          on EVERY household card: 279 returning against 123 first-time, so the
          pair is never absent and never discriminating in the way a chip's
          position implies.

          BOTH gated on household grain, and that is not new: `is_returning` is
          only ever computed for household parties (`_build_household_parties`
          sets it from `prior_cm_ids`), so a person-grain adult weekend guest
          arrives with the Pydantic default `false` — untracked, not "no".
          Drawing First-time there would call every adult weekend regular a
          first-timer.

          A tooltip because the icon carries no words, on the same primitive
          the glyphs use. */}
      {isHousehold && (
        <Tooltip
          content={party.is_returning === true ? 'Returning family' : 'First-time family'}
          // Named for the same reason the need glyphs are: R3 took the words
          // away, so the icon is the only carrier left.
          aria-label={party.is_returning === true ? 'Returning family' : 'First-time family'}
          data-testid="family-card-history"
          // `pl-1.5` is the review artifact's own 6px, and it earns its place:
          // without it the mark sits 4px from the last chip — the row gap
          // alone — and reads as the end of the chip run rather than as a
          // separate mark pinned to the corner.
          //
          // ⚠️ `green`, NOT `forest`, AND THAT WAS MEASURED (owner ruling
          // 2026-08-20). R3 takes the words away, so colour is the ONLY thing
          // separating these two marks — and `forest-700` resolves to
          // `#003917` against a `--foreground` of `#0c3125`: a contrast of
          // **1.08 : 1** between the mark and the card's own text. Returning
          // fires on 279 households of 402, so the common mark was the one
          // nobody could see, while First-time's amber sat at 2.82 : 1.
          // `green-700` is 2.87 : 1, is the review artifact's own `--ret`, and
          // is the ramp `AssignFamilyModal`'s `fits` verdict already uses — so
          // the board carries ONE semantic green. `forest` keeps what it has
          // always been: the lodge's chrome, not a status.
          className={`ml-auto flex-shrink-0 pl-1.5 ${
            party.is_returning === true
              ? 'text-green-700 dark:text-green-300'
              : 'text-amber-700 dark:text-amber-300'
          }`}
        >
          {/* ⚠️ 20px, AND R3 FIRST RULED 16 (owner, 2026-08-20, having seen the
              two at 4×). This mark shares its row with the need glyphs, which
              are 20px chips, and `items-end` bottom-aligns it against them: at
              16px its 13.33px of ink sat 5.33px below the chips' top edge and
              1.33px above their bottom, so the one mark here that is NOT an
              ask read as smaller and lower than the asks beside it. 20px puts
              the ink 1.67px inside each edge, level with the run, and costs no
              height — the chips already set the row at 20px.

              A 20px BOX around the 16px icon was the other candidate: it
              centres the ink vertically but moves it from 2px to 4px off the
              card's right content edge. Rejected on that trade.

              The vocabulary doc's §2 carries the size and this reason; if one
              of them moves, move both. */}
          {party.is_returning === true ? (
            <Repeat className="h-5 w-5" />
          ) : (
            <Star className="h-5 w-5" />
          )}
        </Tooltip>
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

/**
 * The dnd-kit hook results the shell hands the memo'd body — dnd-kit's OWN
 * types, not `Record<string, unknown>`: erased, `attributes` and `listeners`
 * collapse into one structural type, and swapping them at the call site —
 * exactly the mistake the conditional spread below exists to prevent — would
 * type-check.
 */
interface FamilyDnd {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  setNodeRef: (n: HTMLElement | null) => void
  isDragging: boolean
}

const FamilyCardInner = memo(function FamilyCardInner({
  party,
  unit,
  sharedSlot = false,
  inQueue = false,
  isDraggable = false,
  onOpen,
  attributes,
  listeners,
  setNodeRef,
  isDragging,
}: FamilyCardProps & FamilyDnd) {
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
      <FamilyCardChips party={party} unit={unit} sharedSlot={sharedSlot} />
    </div>
  )
})

/**
 * PERF: the dnd-kit subscription, and nothing else.
 *
 * `useDraggable` subscribes to dnd-kit's InternalContext, whose identity
 * changes on every `over` transition — so with the hook inside the card body
 * every family card on the board re-rendered each time the pointer crossed a
 * cabin boundary. Measured on a 73-card board holding 133 placed families:
 * 1,636 body renders across one sweep. Here the hook lives in a shell whose
 * only job is to read it, and the body is `memo`'d.
 */
export function FamilyCard(props: FamilyCardProps) {
  // `disabled` does NOT prevent registration — dnd-kit registers the node in
  // `draggableNodes` unconditionally and `disabled` only nulls the listeners
  // (verified in @dnd-kit/core 6.3.1). What gates the interaction is the
  // conditional spread in the body, which four tests pin. `disabled` is kept
  // for the `aria-disabled` it sets and as a second refusal to hand back
  // listeners.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: partyKey(props.party),
    disabled: props.isDraggable !== true,
  })
  return (
    <FamilyCardInner
      {...props}
      attributes={attributes}
      listeners={listeners}
      setNodeRef={setNodeRef}
      isDragging={isDragging}
    />
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
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot?: boolean
}) {
  return (
    <div className={`${CARD_FRAME} bg-card shadow-lodge-lg border-primary/50 rotate-2`}>
      <FamilyCardIdentity party={party} />
      <FamilyCardChips party={party} unit={unit} sharedSlot={sharedSlot} />
    </div>
  )
}
