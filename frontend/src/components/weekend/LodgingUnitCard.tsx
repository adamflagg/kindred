/**
 * One slot on the board: a room, whoever is in it, and whether that is a
 * problem.
 *
 * A slot, not a column. A summer bunk column is tall because it holds 10–14
 * campers; a lodging unit holds nothing, one party, or — three times in the
 * whole of 2026 — two parties who agreed to share. 82 rooms cannot be 82
 * columns, so these are small cards in a wrapping grid.
 *
 * The card asserts nothing it cannot support. `sleeps: null` means UNKNOWN and
 * renders as an em dash: the API already maps PocketBase's stored 0 to null,
 * and "sleeps 0" would be a lie about a cabin nobody has measured.
 */
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Bath, Merge, Plug, Plus, Snowflake, Split } from 'lucide-react'
import { useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'
import { overlappingPartyKeys, slotOccupancy, type BoardSlot } from './boardLayout'
import { AssignFamilyModal } from './AssignFamilyModal'
import { isValidMergeTarget, mergeDragId, unitDroppableId } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyHeadcount } from './householdIdentity'
import { resolveNeedsFit } from './needsFit'
import { resolveRingPrecedence } from './ringPrecedence'
import { effectiveSleeps } from './rosterAttention'
import { partyKey } from './partyKey'
import { writeInEntries, type UnitAvailabilityWrite } from './writeIn'
import { WriteInCard } from './WriteInCard'

/**
 * The card's border/ring treatment, keyed off an ordered, MUTUALLY EXCLUSIVE
 * `ringState` — these two (plus `plain`) fight over the same CSS slot
 * (`border-color` plus a Tailwind `ring-*` box-shadow), so only one may ever
 * paint at a time. That used to matter concretely: `.border-amber-400`
 * (consent) and `.border-primary` (an active drop target) could both be true
 * at once, and which one painted depended on which utility Tailwind's
 * generated stylesheet happened to emit LATER — a byte offset, not an intent.
 *
 * ⚠️ THERE WAS A THIRD STATE AND IT IS STRUCK (kindred#2179, owner ruling
 * 2026-08-09). `shared` drew a ring in the area hue on any card holding two
 * families, as an inline `boxShadow` because `hue` is a runtime value. It
 * fired on the units DESIGNED to hold several families, so it was on almost
 * all the time — and a constant is not a signal. NOTHING REPLACED IT: not a
 * subtler ring, not a fixed hue, not a smaller dot. `consentFlagged` already
 * outranked it, so every share worth an alarm was already caught. The one
 * occupancy warning that was genuinely rare — a second party in a unit
 * classified `single_party` — was a chip on a channel of its own, and
 * kindred#2072 struck that too: it never fired, because all 23 room-sharing
 * cards in the registry are classified `shareable`.
 *
 * With that ring gone, nothing here writes `box-shadow` inline any more, so
 * `.card-lodge`'s own elevation AND its `:hover` lift (`index.css`) apply to
 * every card again — neither of which the composed inline value could hand
 * back, since inline always beats a stylesheet rule for the same property.
 *
 * Dimming (an invalid merge target mid-drag) and dashing (an empty room) are
 * DELIBERATELY NOT in this table — they are additive booleans where this
 * table is consulted, because `opacity`/`pointer-events` (dimming) and
 * `border-style` (dashing's dashed edge) don't compete with `border-color`
 * or `box-shadow`. Folding all five into one exclusive `cardState` string, as
 * an earlier version of this file did, silently dropped real combinations
 * that used to co-render: a consent-flagged room mid an invalid merge drag
 * lost its amber accent entirely, and an empty room lost its dashed border
 * mid an invalid drag.
 *
 * One piece of dashing is NOT additive, and stays gated below rather than
 * joining `border-dashed` in the unconditional list: the open-space forest
 * tint (#2093, `bg-primary/10`) targets the SAME `background-color` property
 * as `dropTarget`'s own `bg-primary/5` — reintroducing, for exactly this one
 * pairing, the identical byte-offset race this table exists to kill. An empty
 * room being actively hovered for a drop keeps its dashed OUTLINE but not the
 * tint, so `dropTarget`'s own background wins outright.
 *
 * Module scope, not component state: this table references nothing per-card
 * and would otherwise be rebuilt on every one of up to ~82 cards on a board.
 */
const RING_CLASSES: Record<'dropTarget' | 'consentFlagged' | 'plain', string> = {
  dropTarget: 'border-primary ring-primary/50 bg-primary/5 ring-2',
  // `ring-2` rather than the original `ring-1`: promoted when the struck
  // shared mark needed a weight to lose to, and KEPT after it went — a 1px
  // edge was too quiet for the one alarm this card raises at rest.
  consentFlagged: 'border-amber-400 ring-2 ring-amber-400/40 dark:border-amber-500',
  plain: '',
}

/**
 * The needs-misfit mark (#1912) — TEXTURE, and nothing else.
 *
 * The board's hues are committed (forest to area identity, amber to share
 * consent, red to over-capacity), so a fifth meaning cannot have a fifth
 * colour without collapsing the ones that exist. It cannot have an OPACITY
 * either: the 2026-08-09 signal-vocabulary ruling assigns one channel per
 * question, and `opacity-40` is REFUSAL ("you may not") — spoken for by the
 * invalid merge target below, and by that alone since kindred#2432 struck the
 * written-into space's refusal. This mark says "it will work; nothing
 * here meets the need", which is a different KIND of statement rather than a
 * weaker refusal, so it stays at full contrast: legible, droppable, flagged.
 *
 * Additive, never a `RING_CLASSES` entry, for the reason that table's own doc
 * gives: it exists only for channels that fight over one CSS property
 * (`border-color`, `box-shadow`). `background-image` competes with neither —
 * including with #2093's `bg-primary/10` open-space tint, which is
 * `background-color`. The two compose deliberately: a drag-state mark over a
 * resting-state marker, each still saying its own true thing.
 *
 * Degree is the hatch PERIOD and only the period — same angle, same ink, same
 * alpha, tighter lines. Grading NONE from SOME on a second channel is exactly
 * the collapse the ruling struck.
 *
 * An ARBITRARY PROPERTY rather than a `bg-` utility, so there is no question
 * of Tailwind inferring `background-color` from a gradient value; and a
 * `--foreground` token rather than a fixed ink, so the mark inverts with the
 * theme for free. Both class strings are complete literals because Tailwind
 * scans raw source text — a composed string emits nothing at all, which is
 * the `forest-950` failure (#1894) CLAUDE.md §4 names. Verified against a
 * real `vite build`: both rules are in the emitted stylesheet, setting
 * `background-image` and no other property.
 */
const NEEDS_HATCH_CLASSES: Record<'unmet' | 'partial', string> = {
  unmet:
    '[background-image:repeating-linear-gradient(45deg,transparent_0_4px,hsl(var(--foreground)_/_0.1)_4px_5px)]',
  partial:
    '[background-image:repeating-linear-gradient(45deg,transparent_0_10px,hsl(var(--foreground)_/_0.1)_10px_11px)]',
}

export interface LodgingUnitCardProps {
  slot: BoardSlot
  /**
   * The whole registry the board was built from — needed ONLY to expand a
   * container code to the rooms beneath it when deciding which parties overlap
   * (`overlappingPartyKeys`). A card cannot answer that from its own slot: the
   * party naming the building and the party naming one of its rooms both land
   * here, and the codes alone do not intersect.
   *
   * Defaults to `[]`, which degrades to raw-code comparison — correct whenever
   * no container is named, which is every leaf card.
   */
  units?: LodgingUnitRow[]
  /** The area's colour — a SECONDARY channel (§3.10), never the only one. */
  hue: string
  /** Placement is live: a scenario is selected and the user holds `bunking.manage`. */
  canPlace?: boolean
  /**
   * Availability is writable: the user holds `bunking.manage` and a weekend is
   * selected.
   *
   * SEPARATE from `canPlace`, which also requires a scenario. This write
   * CARRIES one and never requires one (kindred#2382 PR 4) — blank is the LIVE
   * board, a scope in its own right — so gating it on one would make a
   * write-in unrecordable unless a draft plan happened to be open.
   */
  canSetAvailability?: boolean
  /** True while THIS unit's availability write is in flight. */
  savingAvailability?: boolean
  /**
   * NO UNIT PARAMETER. The write NAMES the unit it targets (`unitId` on
   * `UnitAvailabilityWrite`), which for an inherited write-in is this card's
   * building or one of its rooms rather than the card itself. Passing the card
   * alongside it would offer the caller the wrong one of the two, which is the
   * bug this shape removes rather than documents.
   */
  onSetAvailability?: (write: UnitAvailabilityWrite) => void
  /**
   * Merge/split is writable: the user holds `bunking.manage` and a weekend is
   * selected.
   *
   * SEPARATE from `canPlace`, which also requires a scenario. A draw level is
   * never CampMinder-sourced — no sync writes it — so, unlike a placement,
   * there is no mirror truth for a merge to overwrite. This is the same two
   * conditions as `canSetAvailability`, for the analogous reason, not a third
   * gate of its own.
   */
  canMerge?: boolean
  /**
   * The card currently being dragged BY ITS MERGE HANDLE, or `null`/`undefined`
   * when no card drag is in flight. Every card receives the same value and
   * decides its own validity from it — the gender-rule analogue for this
   * gesture (`isValidDropTarget` on summer's `BunkCard`).
   */
  mergeSourceUnit?: LodgingUnitRow | null
  /**
   * The FAMILY currently in flight, or `null`/`undefined` when no party drag
   * is running — the same board-wide broadcast `mergeSourceUnit` above is,
   * and for the same reason: every card gets the identical value and decides
   * its own verdict from it.
   *
   * The card has no other way to know. Fit is a question about a PAIR, and
   * until #1912 this component only ever saw one half of it.
   *
   * A merge drag never sets this — `LodgingBoard` clears `dragging` the
   * moment it recognises a card drag — so the misfit hatch and the invalid
   * merge dim cannot be raised by the same gesture, and no gate between them
   * is needed here.
   */
  draggingParty?: RosterPartyRow | null
  /**
   * Split a combined card back into its rooms. Rendered only on one, and
   * only when `canMerge` — `undefined` is how the board spells "not writable
   * right now" under `exactOptionalPropertyTypes`, matching `onSetAvailability`
   * above.
   */
  onSplit?: (unit: LodgingUnitRow) => void
  /**
   * Merge this room into its parent — the ACTIVATION path for the same write
   * the drag gesture makes.
   *
   * The board registers only Mouse and Touch sensors, so the handle is a
   * focusable button announcing itself as draggable that a keyboard cannot
   * work, while its inverse (`Split`) is an ordinary button that a keyboard
   * can. This closes that asymmetry without touching the sensor set, which
   * would change party placement too.
   *
   * No drop target is needed to make the intent unambiguous: merging is
   * PROMOTION TO THE PARENT, and dropping on either sibling resolves to that
   * same parent (`resolveMergeDrop` returns `source.parent_code` whichever
   * sibling was hit), so this asks for the identical write.
   */
  onMerge?: (unit: LodgingUnitRow) => void
  /** True while THIS unit's merge/split write is in flight. */
  savingMerge?: boolean
  /**
   * Every UNPLACED party on the weekend — the picker's list (kindred#2080).
   *
   * NEVER pre-filtered by fit, on the owner's ruling: 6 of 118 units carry a
   * private bathroom against 63 parties asking for one, so a list narrowed to
   * "what fits" would be empty most of the time. `placementCandidates`
   * annotates and orders them instead.
   */
  unplacedParties?: RosterPartyRow[]
  /**
   * Place a family in THIS space — the activation path for the write the drag
   * gesture makes, for a staff member who has the space on screen and not the
   * family.
   *
   * `undefined` is how the board spells "not writable right now" under
   * `exactOptionalPropertyTypes`, matching `onSetAvailability` and `onSplit`
   * above. The board resolves the intent through `resolvePickerPlacement`,
   * which is `resolveDrop` — there is one placement path, not two.
   *
   * Returns NOTHING, deliberately. It used to hand back whether the write
   * actually landed (kindred#2219 round 6, CodeRabbit finding) so the card
   * could hold back an `sr-only` announcement on a refused intent or a
   * rolled-back mutation. kindred#2348 deleted that announcement, and with
   * it the only reader the boolean ever had — a return value nobody reads is
   * a contract that drifts, so it goes with the feature rather than sitting
   * here inviting a future caller to trust it. Both failure paths are still
   * handled where they always were, inside `LodgingBoard.placeParty`.
   */
  onPlaceParty?: (unit: LodgingUnitRow, party: RosterPartyRow) => void
  onOpenParty: (party: RosterPartyRow) => void
}

export function LodgingUnitCard({
  slot,
  units = [],
  hue,
  canPlace = false,
  canSetAvailability = false,
  savingAvailability = false,
  onSetAvailability,
  canMerge = false,
  mergeSourceUnit = null,
  draggingParty = null,
  onSplit,
  onMerge,
  savingMerge = false,
  unplacedParties = [],
  onPlaceParty,
  onOpenParty,
}: LodgingUnitCardProps) {
  const { unit, parties, consent } = slot
  // Suppressed for a write-in ONLY on this card (kindred#2252). The chip and
  // the well's `WriteInCard` below said the same thing twice — the occupant's
  // own name, once as a slate "Write-in" chip and once spelled out in the
  // well — and the well is the one that actually names them, so the chip is
  // redundant here. `reservationBadge` itself is untouched: `MapUnitPopover`'s
  // header and its collapsed grid cell draw no `WriteInCard` of their own and
  // still call it directly, so the chip is still the only signal there.
  /*
   * ⚠️ `reservationBadge` IS NO LONGER READ HERE, and every one of its arms is
   * a ruling rather than an omission (vocabulary §3).
   *
   *   `Building`  — cut 2026-08-19, owner ruling.
   *   `Staff`     — cut. All 25 staff units fail `isPlanningInventory`, so no
   *                 staff card is ever drawn on this board.
   *   `Released`  — cut with the whole release workflow: it needs a staff unit
   *                 or an existing override, and `lodging_availability` is
   *                 empty in every year.
   *   `Write-in`  — already suppressed here since kindred#2252, because the
   *                 `WriteInCard` in the well names the occupant.
   *
   * With all four gone the function draws NOTHING on a board card, so the
   * render site is deleted rather than left standing and quiet. The function
   * itself is untouched: `MapUnitPopover`'s header and its collapsed grid cell
   * still call it, and on that surface the marks still discriminate.
   */
  // On every unit this card can be a SLOT for, which includes a COMBINED
  // container and excludes a split one.
  //
  // Suppressing it on containers wholesale was the first version and was
  // exactly backwards: a split container gets no card at all (`dragPlacement`
  // rejects it as a drop target, and `unitLevel` fans down past it), so the
  // only container that ever reaches this component is a combined one — the
  // whole-house let, which IS the slot staff place into. That is precisely
  // where the owner's ruling lives: two households on one container is a
  // legitimate share, so the whole-house card is the card that most needs to
  // say so. The guard remains as belt-and-braces for the split case rather
  // than being dropped, since nothing here enforces how the card is mounted.
  const isSplitContainer = unit.is_container === true && unit.is_combined !== true
  /*
   * ★ `Sharing unset` BECAME `Reconfirm space`, AND THE GATE MOVED COLUMNS —
   * ruling 23, and the gate is the substance of it.
   *
   * The old chip fired on `shareability`, where all 118 registry rows are
   * classified: 44 shareable, 74 single_party, 0 unset. It could not appear.
   * Keyed on `is_confirmed` it becomes the mark staff actually want — "nobody
   * has checked this cabin this season" — and it goes live the moment
   * kindred#2500 makes a new year start unconfirmed: every unit flagged at
   * season start, worked down as staff check them. Today it draws on nothing,
   * because production is 118 of 118 confirmed.
   *
   * `shareabilityBadge` itself stays in `unitBadges.ts` for `MapUnitPopover`,
   * which still draws `Shared OK` — a permission that has to be legible on a
   * surface with no card geometry to imply it.
   */
  const needsReconfirm = unit.is_confirmed === false
  /*
   * ⚠️ THE WHOLE SPACE, NOT THE CONTAINER ROW (owner ruling 2026-08-20). This
   * read the RAW `unit.sleeps`, which under kindred#2041's delta ruling is a
   * container's beds in space belonging to no single room — the corridor, not
   * the house. All 15 production containers record 0 there, which the API maps
   * to `null`, so every combined house drew `3/—` — "capacity not recorded" —
   * about a building whose rooms are measured and whose beds the backend has
   * summed since #2041.
   *
   * The Assign modal opened FROM this card said "4 of 7 beds free" at the same
   * moment. The card was the last reader of the raw value on the board:
   * `countUnmeasuredSpaces` and `mapModel`'s peek already read this one.
   *
   * The ruling states both halves: *"the card should always show the
   * denominator of total possible sleeps — whether that is a leaf, or a
   * container sum. The modal is always the available diff."* So this figure is
   * capacity and the modal's is the remainder, deliberately, and neither is the
   * other made consistent.
   *
   * ⚠️ A NO-OP FOR EVERY LEAF: `effectiveSleeps` short-circuits on anything
   * that is not a container and returns `unit.sleeps` unchanged, so 103 of the
   * 118 registry rows draw exactly what they drew before. It also keeps the
   * refusal — one unmeasured ACTIVE room leaves the whole total `null` rather
   * than summing what happens to be measured.
   */
  const capacity = effectiveSleeps(unit, units)
  const capacityKnown = capacity !== null
  /*
   * How full the room is. The corner figure used to be CAPACITY alone, so the
   * card read identically whether the room was empty or full.
   *
   * `spanWidth` is why this is not simply a sum. A party holding several rooms
   * is drawn on each of them (#2010, which #2040 left alone), so the same
   * people appear on more than one card and no per-room split exists to divide
   * them by. The count still stands — over-stating reads as "look at this",
   * where dropping the party would read as "room for more" — but the
   * over-capacity CLAIM is withheld, because a household spread across two
   * rooms it needs is not over anything.
   */
  const { occupants, spanWidth } = slotOccupancy(slot, units)
  // `capacity` rather than `capacity ?? 0`: TypeScript narrows it through
  // `capacityKnown`, which is an aliased `!== null` check, so the fallback is
  // unreachable and eslint's type-aware rule says so.
  const overCapacity = capacityKnown && spanWidth === 0 && occupants > capacity
  // The "N families" count chip below: a true statement about the CARD
  // regardless of which rooms anyone actually holds, so it stays keyed on
  // the card's whole party count.
  //
  // The OPEN QUESTION that used to sit here (PR #2119 review, 2026-08-08) —
  // whether the shared-space ring should follow `consent`'s overlap-aware
  // definition rather than this slot-wide count — was ANSWERED on 2026-08-09
  // by striking the ring outright (kindred#2179). The owner's reasoning went
  // past the definition: "the overlap aware should understand disjoint means
  // no shared bedroom, so don't do the overlap glow, it is nonsensical", and
  // then — since the ring lit the units built to hold several families —
  // "let's strike that". The `N families` COUNT CHIP that inherited
  // `parties.length > 1` afterwards is struck too (kindred#2072): it counted
  // what the well already shows by drawing that many cards. Nothing left on
  // this card reads a slot-wide party count, and nothing that judges a SHARE
  // ever did — `consent` goes through `overlappingPartyKeys` below.
  // Each FamilyCard's own "did not request sharing" chip, in contrast, must
  // be a true statement about that ONE party — whether it shares a ROOM with
  // somebody, not merely a merged card. Same overlap definition `consentFlag`
  // uses (`overlappingPartyKeys`), passed the same `units` so the container
  // expansion is identical too: the slot flag and the per-card chip can never
  // answer "do these two overlap" two different ways.
  const overlappingKeys = overlappingPartyKeys(parties, units)

  /*
   * ⚠️ `wholeBuildingHolders` IS NO LONGER READ HERE, and the absence is a
   * ruling (kindred#2072, vocabulary §3 "Earlier cuts, still struck").
   *
   * #2008's `Whole building` chip is struck from the family card: staff know
   * which placements take a house, and the chip cost one of the widest slots
   * in a row that now has to fit up to four need glyphs. The helper itself
   * stays in `boardLayout.ts` — `LodgingMap` and `MapUnitPopover` still draw
   * the chip, on a surface where the card's own geometry says nothing about
   * containment.
   */

  // Merging is promotion to the parent, so a parentless room offers nothing
  // to promote it to — the handle is ABSENT, not merely disabled.
  const hasParent = (unit.parent_code ?? '').length > 0
  const showMergeHandle = canMerge && hasParent
  /*
   * The inverse control, on the combined card itself.
   *
   * `is_container` is part of the gate, not decoration: the API resolves
   * `is_combined` for EVERY row, leaves included, so a leaf can carry a stale
   * `default_combined: true`. The admin form now clears it when "is a
   * building" is unticked, so nothing writes that combination any more — but
   * rows saved before it did still hold it and no migration went back for
   * them, which is why the gate stays. Splitting a room into rooms it does not
   * have is not an operation, so the control is absent rather than offered and
   * then failing.
   *
   * Hoisted out of the JSX by kindred#2072 because the FOOTER now needs to
   * know whether it has anything to draw before it draws itself.
   */
  const showSplitControl =
    canMerge && unit.is_container === true && unit.is_combined === true && onSplit !== undefined
  const mergeDragActive = mergeSourceUnit !== null
  const isValidTarget = isValidMergeTarget(mergeSourceUnit, unit)

  const {
    attributes: mergeAttributes,
    listeners: mergeListeners,
    setNodeRef: setMergeDragRef,
  } = useDraggable({
    id: mergeDragId(unit.code),
    disabled: !canMerge,
  })

  // A SEPARATE droppable from the party target below, registered on the same
  // card: `resolveMergeDrop` requires BOTH ids to carry the `merge:` prefix,
  // so a party dropped here must land on `unitDroppableId`, never this one.
  // Disabled whenever this card is not a legal target for whatever is
  // currently being dragged — which is also "always" when no card drag is in
  // flight, since `isValidMergeTarget` refuses a `null` source.
  const { setNodeRef: setMergeDropRef, isOver: isMergeOver } = useDroppable({
    id: mergeDragId(unit.code),
    disabled: !isValidTarget,
  })

  // Every room accepts a drop while placement is live, including a full or
  // unsuitable one. The fit check is advisory by design: a misfit is surfaced
  // on the board's hatch channel (#1912), never refused at the door, so
  // refusing here would turn an advisory signal into a hard block. This once
  // read "every cabin is unconfirmed until staff walk the property" — no longer
  // true, 118 of 118 confirmed in the production snapshot of 2026-08-06 — but
  // the rule never depended on it.
  //
  // Disabled for every card while a MERGE drag is in flight: without this, a
  // card being dragged onto a sibling would sit over two overlapping,
  // simultaneously-enabled droppables — this one and the merge droppable
  // above — and which one dnd-kit resolves `over` to would be a tie decided
  // by hook registration order, not by which gesture is actually in flight.
  //
  // NOT disabled on a WRITTEN-INTO unit any more — kindred#2432, owner ruling
  // 2026-08-18: *"we should be able to add families to any write in space, or
  // add a write in to a family space — regardless of which came first."* This
  // read `|| held` until then, the AFFORDANCE half of #2090's refusal, whose
  // enforcing half lived in `resolveDrop`. Both went in the same change, and
  // they have to: leaving this one would keep the card from ever reporting
  // `isOver`, so a drop the resolver now accepts could never be aimed at it.
  //
  // Read through `writeInEntries` rather than as an inline
  // `family_available_override === false`, which is what this was until
  // kindred#2078. Three consumers on this card shared that expression under
  // the name `held`, and one of them — #2093's open-tint gate below — was
  // using it as a PROXY for "is somebody in this room". Naming the fact once
  // is what let the proxy be retired in ONE place: kindred#2382 split
  // occupancy into its own scenario-scoped table, and that field now answers
  // the staff↔family role alone. Had the three consumers kept the inline
  // spelling, the split would have had to find all three.
  //
  // A LIST since kindred#2381. A merged container draws in place of its rooms,
  // so every write-in beneath it lands on this card — four of them on the one
  // 2026 building that carries four — and each entry pairs the occupant with
  // the row that holds it, so the card's own X can name that row and no other.
  const writeIns = writeInEntries(unit)
  // Renamed from `held` with kindred#2432, and the rename is the point: this
  // says WHO IS IN IT and no longer says the space is shut. Every surviving
  // reader below is one that genuinely wants "somebody is already in this
  // room" — the em-dash occupancy figure and the open-space to-do tint — and
  // none of them is a refusal.
  const writtenInto = writeIns.length > 0
  const { setNodeRef: setUnitDropRef, isOver: isUnitOver } = useDroppable({
    id: unitDroppableId(unit.code),
    disabled: !canPlace || mergeDragActive,
  })

  // Whether THIS card's Assign modal is open. Per-card state rather than
  // board-level: the modal names one cabin and writes to one cabin, and
  // hoisting it would make every card re-render when any card opened one.
  const [assignOpen, setAssignOpen] = useState(false)

  const setCardRef = (node: HTMLDivElement | null) => {
    setUnitDropRef(node)
    setMergeDropRef(node)
  }

  /*
   * Which of the three mutually-exclusive RING states wins — see
   * `RING_CLASSES` above for why they compete for one slot, why the fourth
   * was struck, and why dimming/dashing are handled separately, additively,
   * below rather than folded in here.
   *
   * Highest wins, and every check below assumes every state above it false:
   *   1. an active drop target — dragging a family onto it, or a card onto
   *      its merge-sibling. The placement affordance has to read clearly
   *      even over a flagged room.
   *   2. the consent flag (#1926) — a household sharing without having
   *      agreed to.
   *   3. plain — neither of the above.
   */
  const ringState = resolveRingPrecedence({
    dropTarget: isUnitOver || isMergeOver,
    consentFlagged: consent !== null,
  })

  /*
   * An invalid merge target mid-drag: dims the card so a doomed drop is not
   * attempted, as summer's `isValidDropTarget()` does for gender. Additive
   * rather than a `ringState` of its own — dimming and, say, the consent
   * amber accent are ORTHOGONAL CSS properties (`opacity`/`pointer-events`
   * vs `border-color`/`box-shadow`) with no reason to be mutually exclusive.
   * Pre-refactor, the two used to co-render; folding them into one exclusive
   * `cardState` string silently dropped that.
   *
   * It suppresses no ring at all now. The one it used to — `shared`'s inline
   * `boxShadow` — is struck (kindred#2179), and consent's Tailwind ring has
   * always stayed lit through the dim because it warns about something the
   * merge drag did not cause and that will still be true once the drag ends.
   */
  const dimmed = mergeDragActive && !isValidTarget

  /*
   * An empty room — the master sheet's "open" case (#2093). Additive for the
   * same reason as `dimmed`: `border-style` (the dashed outline) doesn't
   * compete with `border-color` or `box-shadow`, so an empty room dragged
   * over, or caught in someone else's invalid merge drag, keeps its dashed
   * edge AND whichever ring/dim state is active, rather than losing one to
   * the other.
   */
  const dashed = parties.length === 0

  // The one piece of `dashed` that is NOT unconditionally additive — see
  // `RING_CLASSES`'s doc above for why the open-space forest tint has to
  // stand down specifically against `dropTarget`'s own `bg-primary/5`, both
  // being `background-color`. An empty room mid-hover shows the drop ring's
  // own wash, not its own tint.
  //
  // Owner ruling 2026-08-09 (#2093): HIGHLIGHT an open space with a
  // low-saturation forest tint, not the grey `bg-muted/25` this used to be —
  // grey is the visual language of "deactivated", the opposite of what the
  // one state most wanting staff action should say. `--primary` IS the
  // board's forest hue (index.css), so this reuses the identical token
  // `dropTarget` above already spends at `/5`, just at resting-state
  // strength — the two are close ON PURPOSE and never co-render, which is
  // exactly what this gate enforces. The tint is a RESTING-STATE signal:
  // suppressed the instant this card becomes an active drop target, same as
  // the old wash was.
  //
  // `!writtenInto` is the second gate, and it SURVIVES kindred#2432 on a
  // reason that changed underneath it — which is exactly the kind of gate that
  // gets deleted by accident, so read this before touching it.
  //
  // It used to mean *this cabin may not be filled*: a write-in refused
  // placement outright, so painting it forest sent staff at the one room they
  // could not use. That reason is gone — a written-into cabin now takes a
  // family like any other. What remains is the predicate this gate was always
  // really about: EMPTY and OPEN are different questions, and a room somebody
  // is already sleeping in is not empty. The tint says "the remaining work is
  // HERE", and a cabin with an occupant in its well is not where the remaining
  // work is, even though a second party may now join them.
  //
  // The dashed EDGE still applies to it, being structural rather than an
  // invitation, and that split is unchanged.
  //
  // Keyed on the OCCUPANT SIGNAL, never on the occupant's NAME being filled
  // in: a write-in nobody named still puts somebody in the room, and gating on
  // the name would hand exactly that room back to the to-do marker.
  const openMarkerActive = dashed && !writtenInto && ringState !== 'dropTarget'

  /*
   * The corner figure, and the sentence behind it (kindred#2078).
   *
   * A write-in with nobody else in the room reports the em dash rather than a
   * count: it occupies wholesale and has no party size, so any digit here
   * would assert something nobody recorded. A card carrying BOTH a write-in and
   * a placement keeps the placement count — that is a real number about real
   * people, and the card should not go quiet about them.
   *
   * ⚠️ THAT SECOND CASE IS ROUTINE SINCE kindred#2432 and was a legacy-row
   * curiosity before it, and the number it prints UNDERSTATES a shared space:
   * `lodging_write_ins` carries `occupant_name` and `note` and no count, so the
   * write-in's own party contributes nothing here and the free-bed figure reads
   * high. Filed as kindred#2439 (optional write-in headcount) and ruled an
   * optional investigation rather than a blocker — an understated count on a
   * space staff can share beats a space they could not share at all. Do not
   * "fix" it by guessing a headcount here.
   */
  const wholesaleWriteIn = writtenInto && occupants === 0
  const occupancyFigure = wholesaleWriteIn ? '—' : String(occupants)

  /*
   * kindred#2212 stage 1: why headcount and bed count can disagree.
   *
   * `occupants` above is a BED count -- `slotOccupancy` sums `partySize`,
   * which reads the server-reported `party_size` and falls back to headcount
   * only when nothing was reported. The reader never sees the NAMED headcount
   * anywhere else on this card, so when the two numbers diverge the card goes
   * quiet about why: a child under 18 months (`INFANT_BED_EXEMPT_MONTHS`,
   * `api/constants/lodging.py`) does not consume a bed.
   *
   * Deliberately built from `partyHeadcount` (named adults + every child)
   * against the already-computed `occupants` (bed count), NEVER from
   * `PartyChild.age` directly -- that field is CampMinder `yy.mm` and carries
   * a `0.0` UNKNOWN-AGE SENTINEL, not a newborn's age (kindred#2212). Reading
   * age here would silently sweep that sentinel in as a false "infant". This
   * formula never looks at age at all, so the trap cannot fire: a party whose
   * reported beds already equal its headcount contributes zero regardless of
   * what any child's `age` field says.
   *
   * When `party_size` is unreported (0/null), `partySize` already falls back
   * to `partyHeadcount` for that party, so it contributes nothing to the
   * difference here either -- no separate guard needed.
   */
  const totalHeadcount = slot.parties.reduce((sum, p) => sum + partyHeadcount(p), 0)
  const exemptedInfants = wholesaleWriteIn ? 0 : totalHeadcount - occupants
  const infantExemptionClause =
    exemptedInfants > 0
      ? ` · ${
          exemptedInfants === 1 ? 'an infant is' : `${String(exemptedInfants)} infants are`
        } exempt from the bed count`
      : ''

  const occupancyTooltip = wholesaleWriteIn
    ? capacityKnown
      ? `Written in — occupies the whole room · sleeps ${String(capacity)}`
      : 'Written in — occupies the whole room · capacity not recorded'
    : capacityKnown
      ? `Sleeps ${String(capacity)} · ${String(occupants)} placed${infantExemptionClause}`
      : `Capacity not recorded · ${String(occupants)} placed${infantExemptionClause}`

  /*
   * Whether this space meets the needs of the family in flight (#1912) —
   * `'fits' | 'partial' | 'unmet'`, resolved by `needsFit.ts` against the
   * SERVER's `power_coverage`, which is taken over the unit's leaf
   * descendants rather than off its own row. Twelve of the fourteen 2026
   * family-pool containers record `has_power = 0` while every leaf beneath
   * them has power, so judging a building by the raw flag would mark twelve
   * entirely-powered buildings unpowered. The TITLE ROW's own plug reads the
   * same resolved field since kindred#2072's T2 — it used to render the raw
   * flag, and promoting that to the most prominent row on the card is what
   * made fixing it part of the same change.
   *
   * `'fits'` at rest, and that is the state, not a fallback: with no family
   * in flight there is nothing to be a misfit FOR, and a board hatched all
   * the time says nothing at all.
   *
   * ADVISORY. Nothing below this line touches `useDroppable`, `opacity` or
   * `pointer-events` — the drop is still accepted, exactly as the comment on
   * the party droppable above insists it must be.
   */
  const needsFit = draggingParty === null ? 'fits' : resolveNeedsFit(draggingParty, unit)

  /*
   * kindred#2179's warning: a second party in a space classified for ONE.
   *
   * Read off `overlappingKeys`, never `parties.length`, so it asks about a
   * shared ROOM rather than a shared card — the distinction the struck ring
   * never made, and the reason two households in disjoint rooms of one
   * combined building do not raise it. Judged against THIS card's own unit,
   * which is the level the assignment was made at (owner ruling 2026-08-07).
   *
   * The chip this paragraph used to introduce — `One-family space` — is struck
   * (kindred#2072), along with the `isSplitContainer` gate that kept it and
   * `Shared OK` speaking about the same unit with one voice. Both marks are
   * gone from the card; what survives is `overlappingKeys` itself, which the
   * consent flag and each family card's own sharing chip still read.
   */

  /*
   * Whether this card offers to place a family from itself (kindred#2080).
   *
   * ABSENT, NOT DIMMED, in every negative case. That is a signal decision, not
   * a style one: under the board's ruled vocabulary (2026-08-09) `opacity-40`
   * MEANS refusal and is spoken for by the invalid merge target. An absent
   * control adds no fifth meaning to any channel.
   *
   * THREE gates since kindred#2432, and why each is a gate rather than a fit
   * judgement:
   *
   *   - `isSplitContainer` — `resolveDrop` rejects one as a target, and it
   *     gets no card anyway; belt-and-braces, exactly as `sharing` above.
   *   - no writer / no `canPlace` — no scenario, or no `bunking.manage`.
   *
   * ⚠️ A FOURTH GATE, `!held`, was struck by kindred#2432 and must not come
   * back. It said "a hold blocks placement outright (#2087/#2090), so offering
   * the control would name an action that writes nothing" — true only while
   * `resolveDrop` refused a written-into space, which it no longer does.
   * `resolvePickerPlacement` is a thin adapter over `resolveDrop`, so a gate
   * here that RESTATES a refusal the resolver makes is the drift that design
   * exists to prevent, and a gate that CONTRADICTS one is worse still.
   *
   * `parties.length === 0` is neither, and the distinction is the one to hold
   * on to before reading the rule above as licence to delete it: the resolver
   * ACCEPTS a second family onto an occupied card, and so does the drag. This
   * gate does not refuse that placement — it declines to OFFER it from a
   * surface whose question is "which family goes in this empty space", leaving
   * the deliberate path (drag) intact. A gate that removes an affordance
   * without removing an outcome is a scoping choice; only a gate that changes
   * what the board will accept would be the drift.
   *
   * NOT gated on the list being empty. "Everyone has a cabin" is a real
   * answer to the question the control asks, and the picker says it; hiding
   * the control instead would leave staff wondering where it went.
   *
   * ★ NO LONGER GATED ON `parties.length === 0` (owner ruling, 2026-08-18).
   *
   * It was, and the reason was sound while this box only placed families: the
   * card already holding one is not the card staff are looking to fill, and a
   * second family reaches a shareable space by drag. That reasoning does not
   * survive the box becoming the ONLY way to write somebody in. The owner hit
   * it on a merged building:
   *
   *   > "if i populate 3/4 of clouds rest, i cannot add a write in directly
   *   >  to it"
   *
   * — because the strip's "Write in" action refused an occupied card (#2090)
   * and this box was hidden by the same condition, so a partly-filled merged
   * container offered NO input at all. A container is the case that bites,
   * since its rooms lose their own cards to the merge and there is nowhere
   * else to go.
   *
   * Family rows on an occupied card are not a new claim: this control has
   * always annotated rather than refused, and every refusal on the path is
   * still `resolvePickerPlacement` → `resolveDrop`'s, inherited whole.
   */
  const canOfferPlacement = canPlace && onPlaceParty !== undefined
  /**
   * THE DIVERGENCE FROM `canPlace`, preserved from the strip's write-in.
   *
   * Who is sleeping in a cabin is a fact about the WEEKEND, not about a plan,
   * so staff must be able to record one without first creating a scenario.
   * The strip's "Write in" was gated on `canSetAvailability`, never on
   * `canPlace`, and the box that replaced it has to keep that — otherwise the
   * CampMinder mirror loses its write-in path entirely.
   */
  const canOfferWriteIn = canSetAvailability && onSetAvailability !== undefined
  /**
   * ⚠️ TWO GATES WERE STRUCK HERE AND NEITHER MAY COME BACK.
   *
   *   `parties.length === 0` — struck 2026-08-18. Coherent while this box only
   *   placed families; incoherent once it became the only way to write somebody
   *   in, because a partly-filled merged building then had no input at all.
   *
   *   `!writtenInto` — struck with kindred#2432. It refused the box on a card
   *   that already holds a write-in, which is the mirror of the same mistake:
   *   the reported case is one paper registration sharing a cabin with one
   *   placed family, and this gate blocked the second half of it.
   *
   * Together they are the "mix and match" rule: a family and a write-in may
   * share a space in either order, on a leaf or on a container, and each is
   * removed independently.
   */
  const canPickFamily = (canOfferPlacement || canOfferWriteIn) && !isSplitContainer

  const cardStateClassName = [
    RING_CLASSES[ringState],
    dashed ? 'border-dashed' : '',
    openMarkerActive ? 'bg-primary/10' : '',
    // Additive and UNGATED against everything above it — see
    // `NEEDS_HATCH_CLASSES`. `background-image` competes with no other
    // channel on this card, tint included.
    needsFit === 'fits' ? '' : NEEDS_HATCH_CLASSES[needsFit],
    dimmed ? 'pointer-events-none opacity-40' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // The title half of the same forest-tint signal (#2093) — additive for the
  // identical reason `dashed` itself is (see that comment above): `color`
  // and `font-weight` on this child `<h3>` don't compete with the parent's
  // `border-color`/`box-shadow`/`background-color` channels, so this is a
  // plain either/or on ONE property pair rather than a `RING_CLASSES` entry.
  // Deliberately reuses `openMarkerActive` rather than bare `dashed`: the
  // owner ruling frames the tint as ONE resting-state signal, and a title
  // that stayed bold forest while the background wash had already stood down
  // — for an active drop target, or for a room somebody is written into —
  // would be the two halves of the same mark silently drifting apart.
  const openTitleClassName = openMarkerActive
    ? 'text-primary font-bold'
    : 'text-foreground font-semibold'

  return (
    <div
      data-unit-card
      data-unit-code={unit.code}
      // ABSENT rather than `"fits"` when there is nothing to say, so the
      // attribute is a mark rather than a per-card verdict log — and so
      // `exactOptionalPropertyTypes` keeps it out of the DOM entirely.
      //
      // No ARIA counterpart, deliberately: this is a drag-state affordance,
      // and the board registers Mouse and Touch sensors only, so there is no
      // keyboard drag for a screen reader to be mid-way through. The roster's
      // own `attentionSections` is where the same fact is stated in text.
      {...(needsFit === 'fits' ? {} : { 'data-needs-fit': needsFit })}
      ref={setCardRef}
      // The area's top edge, and NOTHING else — §3.10's secondary channel,
      // which the #2179 deletion deliberately did not take with it. No
      // `boxShadow` here any more: `.card-lodge`'s own elevation and its
      // `:hover` lift are both the `box-shadow` property, and an inline value
      // beats a stylesheet rule outright, so the struck ring was silently
      // flattening every shared card's hover.
      style={{ borderTopColor: hue }}
      /*
       * `.card-lodge` is summer's card chrome, not a lookalike — the same
       * class `BunkCard` wears (CLAUDE.md §4, "Family Camp Models Summer").
       * It carries `bg-card`, `rounded-2xl`, a 2px border, the two-layer
       * lodge shadow and the hover lift. This card used to hand-roll
       * `bg-card rounded-xl border`, which is the same idea minus the shadow
       * and the hover — so it read as a table row rather than a card.
       *
       * Every utility below outranks `.card-lodge` itself regardless of
       * string order — it lives in `@layer components`, so `cardStateClassName`
       * always beats its `border-border` and `border-primary/50` hover. What
       * is NOT order-independent is `RING_CLASSES`' entries against EACH
       * OTHER, which is exactly why `ringState` above picks one rather than
       * concatenating four; the dashed/dimmed fragments alongside it are
       * additive on purpose (see their own comments) and never race anything
       * in this table. The hue top edge is a separate inline style and
       * outranks all of it, which is what keeps §3.10's secondary channel
       * alive underneath whichever state wins.
       *
       * NO `hover:shadow-lodge-lg` HERE, though `BunkCard` carries one. That
       * class is inert: `.shadow-lodge-*` are hand-written rules in `@layer
       * utilities`, not Tailwind `@utility` declarations, so v4 emits no
       * `hover:` variant of them — verified in the browser, where no selector
       * matching `hover.*shadow-lodge` exists in any of the 3,373 loaded
       * rules. Summer's hover lift comes entirely from `.card-lodge:hover`,
       * which this card already has. Copying the class would have propagated
       * a no-op by imitation, which is the `forest-950` failure (#1894) that
       * CLAUDE.md §4 names by name.
       *
       * ⚠️ THE PADDING AND THE GAP ARE DELIBERATELY **NOT** SUMMER'S, AND THIS
       * PARAGRAPH USED TO SAY THE OPPOSITE — B·1, kindred#2072.
       *
       * It read: "`gap-3` is summer's 12px row rhythm (`BunkCard` separates
       * header, bar and roster with `mb-3`). This ran at a flat 8px, which
       * left the title sitting on top of the amenity row." Both halves were
       * true when written, and the second one is what has changed: T2 lifted
       * the amenities onto the title row, so there is no amenity row left for
       * the title to sit on top of.
       *
       * The divergence is TOPOLOGY, not taste, which is the bar CLAUDE.md §4
       * sets. A summer bunk card holds 10–14 campers, so 16px of padding and a
       * 12px rhythm are a small fraction of a tall card. A lodging card holds
       * nothing, one party, or occasionally two — at `p-4` the chrome was most
       * of an empty card, and 81% of live cards are empty. The review artifact
       * measured `p-2.5 px-3` plus `gap-2` at 148px off the board, 8.3%, and
       * with B·2's dropped well min-height about −15% of column height — the
       * two were measured together and found perfectly additive.
       *
       * ⚠️ DRIVEN IN A BROWSER AFTERWARDS THE WHOLE STAGE LANDS BIGGER: the
       * 2026 board's scroll height goes 7000px → 5286px (−24.5%) and the sum
       * of its 73 card heights 19937px → 14373px (−27.9%). The difference is
       * not padding — the mock measured the geometry alone, where the shipped
       * change also removed the empty-state sentence, the meta row and five
       * chips. The card is shorter because it SAYS LESS, and only secondarily
       * because it is tighter.
       *
       * `px-3` rather than a flat `p-2.5`: the horizontal squeeze is what the
       * ~244px inner width can least afford, so the vertical tightening is the
       * aggressive half and the horizontal one is not.
       */
      className={`card-lodge flex flex-col gap-2 border-t-[3px] p-2.5 px-3 ${cardStateClassName}`}
    >
      {/* THE TITLE ROW — T2, and the amenities ride it as a VARIABLE BLOCK.
          A fixed three-icon slot truncates six of the 73 drawn names at the
          280px column, and truncates the WRONG END: those six are a numbered
          series whose only distinguishing character is the last one, so a
          fixed slot leaves six identical-looking cards. Drawn only when the
          room has them, the block fits every card with ≥31px to spare. The
          board lives in a 280–292px band, so it sits on the cliff rather than
          past it — do not assume a wider column will save it. */}
      <div data-testid="unit-title-row" className="flex items-center gap-1.5">
        {/* Summer's scale, not a parallel one (CLAUDE.md §4): `text-lg` title
            over `text-sm` body over `text-xs` meta, the same three steps
            `BunkCard` uses. This card was built on `text-[13px]` /
            `text-[11px]` / `text-[10px]`, whose LARGEST size was smaller than
            summer's body.

            An `<h3>`, as `BunkCard` titles its bunk, and the tag is doing
            typographic work rather than only semantic: `index.css` gives
            `h1, h2, h3` the display face (Fraunces, `-0.02em`, `ss01`/`ss02`).
            As a `<span>` this title rendered the same 18px in the body sans,
            which is why the boards still read differently once the sizes
            matched. `text-lg` is a utility and outranks the base rule's
            `text-2xl md:text-3xl`, so only the face and tracking carry over.

            `min-w-0` is what lets `truncate` fire at all: a flex child's
            default `min-width: auto` refuses to shrink below its content, and
            the title now has icons beside it competing for the row. */}
        <h3 className={`min-w-0 truncate text-lg ${openTitleClassName}`}>{unit.name}</h3>
        {/* PRESENCE, AND NEVER WHICH KIND (ruling 2). The meta row spelled
            this out as `Bath Private` / `Bath Shared`; the CampMinder question
            behind the family's flag asks for "a bathroom that doesn't require
            you to leave your cabin", which is `bathroom != 'none'`, and a
            shared unit satisfies it as fully as a private one. Of the 6
            private units, 5 are staff housing no weekend has ever released —
            so the distinction is one no staff member on this board can act on.
            Vocabulary §4 carries the full correction; kindred#2501 is the
            matching fix to the family-side RULE, which still grades
            exclusivity for one more release. */}
        {unit.bathroom !== undefined && unit.bathroom !== 'none' && unit.bathroom !== 'unknown' && (
          <Bath
            data-testid="amenity-bathroom"
            aria-label="Bathroom in unit"
            className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0"
          />
        )}
        {/* `power_coverage`, NEVER the raw `has_power` — see `needsFit` above.
            The raw flag drew no plug on twelve entirely-powered buildings, and
            T2 would have made that the first thing staff read.

            PRESENCE again, so `some` draws the plug: the mark says the
            building offers power somewhere. Whether it reaches a particular
            family is the need glyph's question, and `needsFit` already grades
            `some` as the softer misfit on the drag hatch. */}
        {(unit.power_coverage ?? 'unknown') !== 'none' &&
          (unit.power_coverage ?? 'unknown') !== 'unknown' && (
            <Plug
              data-testid="amenity-power"
              aria-label="Power"
              className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0"
            />
          )}
        {/* NO DEMAND COUNTERPART, and that is measured rather than assumed: 0
            of 184 housing narratives mention air conditioning, against 54 for
            a bathroom, 34 for CPAP power and 11 for a fridge — so the same
            scan that found the others found none of these. It stays because
            staff place against it; it gets no glyph because nobody asks. */}
        {unit.has_ac === true && (
          <Snowflake
            data-testid="amenity-ac"
            aria-label="Air conditioning"
            className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0"
          />
        )}
        {/* The tooltip hangs on THIS figure, never on the `<h3>` above it
            (kindred#2177). It is also the smallest trigger on the board, which
            is why `ui/Tooltip` grows a transparent 24px hit target around
            whatever it wraps — a drawn box would collide with the dashed
            border this card already spends on "empty room".

            ⚠️ THE RED FIGURE IS NOW THE WHOLE OVER-CAPACITY MARK. The
            `Over capacity` pill beside it is struck: it stated at chip weight
            exactly what the figure states in colour, on the two cards a
            weekend that qualify. */}
        <Tooltip
          content={occupancyTooltip}
          data-testid="unit-occupancy"
          className={`ml-auto text-sm tabular-nums ${
            overCapacity ? 'text-destructive font-semibold' : 'text-muted-foreground'
          }`}
        >
          {/* An unmeasured room keeps the em dash as its DENOMINATOR. `0/0`
              would be the same lie the em dash exists to refuse.

              A write-in takes it as the NUMERATOR, for the same reason: it
              occupies the room WHOLESALE, with no party size and no partial
              bed arithmetic, so `0/5` beside a full room is a lie and `5/5`
              is a different one. The em dash is this card's existing way of
              refusing to assert a number it does not have. */}
          {`${occupancyFigure}/${capacityKnown ? String(capacity) : '—'}`}
        </Tooltip>
      </div>

      {/* THE META ROW, AND IT RENDERS ONLY WHEN IT HAS SOMETHING TO SAY (0a).
          Ruling 12 deleted this row on the premise that T2 and the footer move
          empty it. They empty EIGHT of its ten things; `Inactive` and
          `Reconfirm space` were in neither set and nobody ruled them cut, so
          deleting the row literally would have deleted two marks by accident.

          Conditional rather than rehomed, on the owner's ruling: on today's
          data neither fires — 0 of 118 inactive, 118 of 118 confirmed — so
          every live card gets ruling 12's outcome including its 12px gap, and
          both marks keep a home for when kindred#2500 makes a new season start
          unconfirmed and flags all 118 at once. */}
      {(needsReconfirm || unit.is_active === false) && (
        <div
          data-testid="unit-meta"
          className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm"
        >
          {needsReconfirm && (
            <span className="border-border text-muted-foreground rounded-full border px-1.5 py-0.5 text-xs font-medium">
              Reconfirm space
            </span>
          )}
          {/* A deactivated room only reaches the board when somebody is still
              in it — hiding it would drop them. Kept for that unlikely case,
              and parked for staff input along with the sharing chips. */}
          {unit.is_active === false && (
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
              Inactive
            </span>
          )}
        </div>
      )}

      {/* A household answered `no_share` and is sharing anyway — the
          consent warning, `docs/reference/weekend-card-vocabulary.md` §1
          (a gitignored "spec §11" until kindred#2072). On 2026 data this
          fires exactly once, and that one case is real. Still PENDING STAFF
          INPUT: it is one of five marks parked for them.

          ⚠️ THE `N families` CHIP THAT USED TO SIT ABOVE IT IS STRUCK. It
          counted what the well below already shows by drawing that many
          cards, and it fired on every shared card — including the ones built
          to be shared. This sentence is the mark that survived that cut,
          because `consentReason` builds a whole statement rather than a
          count. */}
      {consent && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{consent.reason}</p>
      )}

      {/*
        The occupant well — ONE element across both branches. Two wells drift;
        this one cannot.

        `flex-1` STAYS, and it is what makes dropping the grid's `items-start`
        survivable. A grid row is already as tall as its tallest card, so
        stretching the cards reclaims no space at all — it moves the whitespace
        from outside the card border to inside it. Without a well that absorbs
        the extra height, stretch just yields 28 blown-up empty cards with
        their contents pinned to the top edge, which is worse than the
        raggedness it fixes.

        ⚠️ `min-h-[100px]` IS STRUCK (B·2), and it is a DIFFERENT decision from
        `flex-1` above — read that before restoring it. It was summer's, and it
        earned its place by lifting an empty card off its 139px floor toward
        the 188px occupied median so rows started closer together. What paid
        for it was the empty-state sentence sitting in the middle of that
        space; with `Drop families here` struck there is nothing in an empty
        well to give height TO, and 81% of live cards are empty. Measured with
        B·1 and found perfectly additive: about −15% of column height together.
      */}
      <div data-testid="occupant-well" className="flex flex-1 flex-col gap-2">
        {/* A write-in, drawn where the board draws occupancy (kindred#2078).
            FIRST and unconditionally, never in an either/or with the parties
            below. That was defensive when it was written — #2090 ruled the two
            mutually exclusive, so a card carrying both was only reachable
            through a legacy row — and kindred#2432 makes it the ROUTINE state:
            a paper registration recorded as a write-in, sharing the cabin with
            a placed CampMinder family.

            ⚠️ THIS IS #2091'S VISUAL PRECEDENT, deliberately and by default.
            "Mark a space that holds two families the way the master housing
            sheet does" is unbuilt, so whatever a shared well looks like here is
            what it will look like there. The chosen form is the most
            conservative one available: ONE well, the occupants stacked in the
            order they already stack, NO divider, NO new chip, NO new colour —
            the existing `WriteInCard` and `FamilyCard` frames unchanged. A
            shared space is not a new KIND of card; it is a card with two
            occupants in it. If #2091 later wants a shared-space treatment it
            should EXTEND this rather than contradict it. */}
        {writeIns.map((entry) => (
          <WriteInCard
            key={entry.source.unitId}
            occupant={entry.occupant}
            // WHOSE row it is, and undefined whenever it is this card's own —
            // so the common case says nothing extra. Restored during review of
            // kindred#2381: a merged container's well can hold four occupants
            // sleeping in four DIFFERENT rooms, and a split building's rooms
            // each draw a card for the one row the building holds, so without
            // this a name in the well names no space at all.
            // BOUND TO THIS ROW, which is the whole point of the per-card X:
            // the strip's single "Clear Write-in" named whichever row the
            // server resolved first, so on a merged building a click removed
            // one, the card re-populated with the next occupant, and the
            // action read as a no-op while it destroyed them one by one.
            //
            // `familyAvailable: null` DELETES, and the occupant and reason are
            // empty because a removal asserts nothing — the same write the
            // strip's clear sent, now pointed at a row the reader can see.
            {...(canSetAvailability && onSetAvailability !== undefined
              ? {
                  onRemove: () => {
                    onSetAvailability({
                      unitId: entry.source.unitId,
                      unitName: entry.source.unitName,
                      familyAvailable: null,
                      occupantName: '',
                      reason: '',
                    })
                  },
                  // BOUND TO THIS ROW for the same reason `onRemove` is — kindred#2430.
                  // `familyAvailable: false` is the write-in "hold" value, never
                  // `null`: `set_availability` upserts a write-in
                  // (`_upsert_row(what='write-in', ...)`), so this write updates
                  // the existing row rather than creating a second one.
                  onEdit: (write: { occupantName: string; reason: string }) => {
                    onSetAvailability({
                      unitId: entry.source.unitId,
                      unitName: entry.source.unitName,
                      familyAvailable: false,
                      occupantName: write.occupantName,
                      reason: write.reason,
                    })
                  },
                }
              : {})}
            isSaving={savingAvailability}
          />
        ))}
        {/* ⚠️ THE EMPTY-STATE SENTENCE IS STRUCK, AND ITS ABSENCE IS THE
            RULING (vocabulary §3).

            It read `Drop families here` while placement was live and `Empty`
            otherwise — summer's wording in family vocabulary, centred with
            `m-auto` because these cards stretch across a 139–357px range, and
            it stood down for a write-in because "Drop families here" under a
            named occupant describes the wrong space.

            At 81% of live cards empty it was the most-repeated sentence on the
            board, and the dashed border plus an empty well already say it.

            ⚠️ `lodging-board-vs-summer.md` §3 argued FOR this text — that
            paragraph is superseded, and has been edited rather than left
            standing.

            It took `min-h-[100px]` with it: the min-height's whole job was to
            give this sentence room to sit in. */}
        {parties.map((party) => (
          <FamilyCard
            key={partyKey(party)}
            party={party}
            unit={unit}
            sharedSlot={overlappingKeys.has(partyKey(party))}
            isDraggable={canPlace}
            onOpen={onOpenParty}
          />
        ))}
      </div>

      {/* THE FOOTER ROW — the controls, moved out of the meta row.
          Assign, Merge and Split answer "what do I do with this space", where
          every mark above answers "what IS this space". Mixing the two in one
          wrapping row is what made the meta row a general-purpose strip in the
          first place, and it is why a card could grow a control and a badge
          that said the same thing. Below the well, so the card reads
          title → state → occupants → actions.

          ABSENT ENTIRELY when nothing is offered, rather than an empty row
          spending a gap on nothing — the same rule the meta row now follows. A
          read-only board draws neither. */}
      {(canPickFamily || showMergeHandle || showSplitControl) && (
        <div
          data-testid="unit-footer"
          className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm"
        >
          {/* kindred#2080 — the space's own placement path, for the staff
              member who has the cabin on screen and not the family.

              ⚠️ A PILL THAT OPENS A MODAL SINCE AS2 (owner, 2026-08-19), which
              SUPERSEDES the 2026-08-09 ruling this control was built on — "not
              a popover and not a second surface", option A, literally Hold's
              shape. The supersession is scoped to this one control, and the
              width is what buys it: a candidate row carries party size against
              the beds left, the need glyphs coloured against this room, last
              year's cabin and a fit verdict, none of which fits in a 244px
              card. It also collapses ~82 mounted comboboxes to one.

              NAMED FOR THE CABIN, as the combobox was: ~82 controls all called
              "Assign" is unusable, and the visible word is the only thing that
              fits on the pill. AND NAMED FOR WHAT THIS CARD CAN ACTUALLY DO —
              on the CampMinder mirror there is no scenario, so nothing can be
              PLACED and the modal opens as a write-in box only. */}
          {canPickFamily && (
            <button
              type="button"
              aria-label={
                canOfferPlacement
                  ? `Assign to ${unit.name}`
                  : `Write in an occupant for ${unit.name}`
              }
              disabled={savingAvailability}
              onClick={() => {
                setAssignOpen(true)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              Assign
            </button>
          )}
          {/* Merging is promotion to the parent: dragging this handle onto a
              sibling's card writes `combined: true` on the shared parent.
              Absent entirely on a parentless room — there is nothing to
              promote it to — rather than merely disabled. */}
          {showMergeHandle && (
            <button
              type="button"
              ref={setMergeDragRef}
              data-testid={`merge-handle-${unit.code}`}
              aria-label={`Merge ${unit.name} into its building`}
              disabled={savingMerge}
              {...mergeAttributes}
              {...mergeListeners}
              // AFTER the listener spread, so dnd-kit cannot overwrite it. The
              // two do not race: MouseSensor activates at 10px, and a plain
              // click never travels that far — the same reason the card itself
              // stays clickable while being draggable.
              onClick={() => {
                onMerge?.(unit)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex cursor-grab items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium active:cursor-grabbing disabled:opacity-40"
            >
              <Merge className="h-3 w-3" />
              Merge
            </button>
          )}
          {showSplitControl && (
            <button
              type="button"
              disabled={savingMerge}
              aria-label={`Split ${unit.name} into its rooms`}
              onClick={() => {
                // Not `onSplit?.` — `showSplitControl` above already requires
                // it, and TypeScript narrows through that `const`.
                onSplit(unit)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium disabled:opacity-40"
            >
              <Split className="h-3 w-3" />
              Split
            </button>
          )}
        </div>
      )}

      {/* MOUNTED ONLY WHILE OPEN. `ui/Modal` portals to `document.body`, so
          nothing here sits inside the card's own stacking context or its
          `overflow-hidden` grid — and, more to the point, the whole
          annotate-and-sort over the unplaced queue happens for one card
          rather than for all ~82. */}
      {assignOpen && (
        <AssignFamilyModal
          isOpen={assignOpen}
          onClose={() => {
            setAssignOpen(false)
          }}
          unit={unit}
          // EMPTY where placement is refused, which is how the modal knows it
          // is a write-in box rather than both. Passing the queue anyway would
          // offer rows that `resolvePickerPlacement` refuses.
          parties={canOfferPlacement ? unplacedParties : []}
          units={units}
          // The card's own numerator, passed rather than re-derived: the modal
          // states beds FREE against it, and two computations of one figure is
          // how the header and the card start disagreeing.
          occupants={occupants}
          // The same figure the card withholds its own over-capacity claim on
          // — see the modal's `spanWidth` doc. Passed rather than re-derived,
          // so the two surfaces cannot answer "is this over capacity" two
          // different ways.
          spanWidth={spanWidth}
          isSaving={savingAvailability}
          onSelect={(party) => {
            onPlaceParty?.(unit, party)
          }}
          {...(canOfferWriteIn
            ? {
                // The write the strip's "Write in" action used to send.
                // `familyAvailable: false` IS the write-in (kindred#2382 moved
                // the row out of `lodging_availability`, and the write shape
                // stayed).
                //
                // ★ THE NOTE IS CARRIED NOW. The inline box sent `reason: ''`
                // with a comment saying that path did not collect one, so a
                // staff member wanting to record WHY had to write the occupant
                // in and then edit it from the pencil on its own card. The
                // modal has room for the field, so the first write carries it.
                onWriteIn: (write: { occupantName: string; note: string }) => {
                  onSetAvailability({
                    unitId: unit.unit_id,
                    unitName: unit.name,
                    familyAvailable: false,
                    occupantName: write.occupantName,
                    reason: write.note,
                  })
                },
              }
            : {})}
        />
      )}
    </div>
  )
}
