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
import { Bath, Merge, Plug, Snowflake, Split, TriangleAlert, Users } from 'lucide-react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'
import {
  overlappingPartyKeys,
  slotOccupancy,
  wholeBuildingHolders,
  type BoardSlot,
} from './boardLayout'
import { isValidMergeTarget, mergeDragId, unitDroppableId } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyHeadcount } from './householdIdentity'
import { resolveNeedsFit } from './needsFit'
import { PlaceFamilyPicker } from './PlaceFamilyPicker'
import { resolveRingPrecedence } from './ringPrecedence'
import { partyKey } from './partyKey'
import {
  reservationBadge,
  shareabilityBadge,
  sharingConflictBadge,
  writeInBadgeApplies,
  type UnitBadge,
} from './unitBadges'
import { UnitAvailabilityControl } from './UnitAvailabilityControl'
import type { UnitAvailabilityWrite } from './UnitAvailabilityControl'
import { writeInEntries } from './writeIn'
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
 * occupancy warning that is genuinely rare — a second party in a unit
 * classified `single_party` — is a CHIP in the badge row below
 * (`sharingConflictBadge`), on a channel of its own.
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
 * question, and `opacity-40` is REFUSAL ("you may not") — the invalid merge
 * target below and #2087's held space. This mark says "it will work; nothing
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

/**
 * The one-family-space warning chip (kindred#2179), with its count reachable
 * by keyboard and touch rather than by mouse hover alone (kindred#2177).
 *
 * `UnitBadge.title` is optional, so the no-detail case renders a plain
 * `<span>`: a focusable chip that reveals nothing is a dead stop in the tab
 * order, which is the same reason `FamilyCard`'s `Chip` and
 * `SharePreferenceChip` branch the same way.
 */
function SharingConflictChip({ badge }: { badge: UnitBadge }) {
  const className = `inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.className}`
  const body = (
    <>
      <TriangleAlert className="h-3 w-3 flex-shrink-0" />
      {badge.label}
    </>
  )
  if (badge.title === undefined) return <span className={className}>{body}</span>
  return (
    <Tooltip content={badge.title} className={className}>
      {body}
    </Tooltip>
  )
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
  const badge = writeInBadgeApplies(unit) ? null : reservationBadge(unit)
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
  const sharing = isSplitContainer ? null : shareabilityBadge(unit)
  const capacityKnown = unit.sleeps !== null && unit.sleeps !== undefined
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
  const overCapacity = capacityKnown && spanWidth === 0 && occupants > (unit.sleeps ?? 0)
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
  // "let's strike that". So `parties.length > 1` now drives ONLY this count
  // chip, where a slot-wide count is the true statement. Nothing that judges
  // a SHARE reads it: `consent` and `sharingConflictBadge` both go through
  // `overlappingPartyKeys` below.
  const isShared = parties.length > 1
  // Each FamilyCard's own "did not request sharing" chip, in contrast, must
  // be a true statement about that ONE party — whether it shares a ROOM with
  // somebody, not merely a merged card. Same overlap definition `consentFlag`
  // uses (`overlappingPartyKeys`), passed the same `units` so the container
  // expansion is identical too: the slot flag and the per-card chip can never
  // answer "do these two overlap" two different ways.
  const overlappingKeys = overlappingPartyKeys(parties, units)

  // #2008: read against each party's OWN occupied leaves, not the slot's
  // combined membership — two households splitting this card between
  // disjoint rooms neither holds it alone, even when the CARD itself is the
  // whole building. Computed from THIS slot's own parties, the same way
  // `overlappingKeys` above is: the answer depends only on a party's own
  // occupied codes, never on its neighbours in the slot.
  const wholeBuildingKeys = wholeBuildingHolders(parties, units)

  // Merging is promotion to the parent, so a parentless room offers nothing
  // to promote it to — the handle is ABSENT, not merely disabled.
  const hasParent = (unit.parent_code ?? '').length > 0
  const showMergeHandle = canMerge && hasParent
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
  // Disabled on a WRITTEN-INTO unit (#2078/#2087): a write-in blocks placement
  // outright, per the owner ruling on #2090. This is the AFFORDANCE half — it
  // keeps dnd-kit from ever reporting `isOver` here, so the card cannot even
  // highlight as a target — while `resolveDrop` (`dragPlacement.ts`) is the
  // half that actually enforces it, because #2080 adds a placement path that
  // reaches `resolveDrop` without ever touching this hook.
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
  const held = writeIns.length > 0
  const { setNodeRef: setUnitDropRef, isOver: isUnitOver } = useDroppable({
    id: unitDroppableId(unit.code),
    disabled: !canPlace || mergeDragActive || held,
  })

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
  // `!held` is the second gate, and it is not cosmetic: EMPTY and
  // OPEN are different predicates and this is where they part. A write-in
  // blocks placement outright (`held` above; `dragPlacement.ts` refuses the
  // drop), so a written-into cabin has no family in it and can take none.
  // That was harmless while the empty treatment was a neutral grey wash, but
  // the forest tint says "the remaining work is here" — and the marker is the
  // to-do list. Painting such a cabin forest sends staff at the one room they
  // may not fill. The dashed EDGE still applies to it, being structural
  // rather than an invitation.
  //
  // Keyed on the OCCUPANT SIGNAL, never on the occupant's NAME being filled
  // in: a write-in nobody named still closes the room, and gating on the name
  // would hand exactly that room back to the to-do marker.
  const openMarkerActive = dashed && !held && ringState !== 'dropTarget'

  /*
   * The corner figure, and the sentence behind it (kindred#2078).
   *
   * A write-in with nobody else in the room reports the em dash rather than a
   * count: it occupies wholesale and has no party size, so any digit here
   * would assert something nobody recorded. A card that somehow carries BOTH a
   * write-in and a placement keeps the placement count — that is a real number
   * about real people, and the card should not go quiet about them.
   */
  const wholesaleWriteIn = held && occupants === 0
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
      ? `Written in — occupies the whole room · sleeps ${String(unit.sleeps)}`
      : 'Written in — occupies the whole room · capacity not recorded'
    : capacityKnown
      ? `Sleeps ${String(unit.sleeps)} · ${String(occupants)} placed${infantExemptionClause}`
      : `Capacity not recorded · ${String(occupants)} placed${infantExemptionClause}`

  /*
   * Whether this space meets the needs of the family in flight (#1912) —
   * `'fits' | 'partial' | 'unmet'`, resolved by `needsFit.ts` against the
   * SERVER's `power_coverage`, which is taken over the unit's leaf
   * descendants rather than off its own row. Twelve of the fourteen 2026
   * family-pool containers record `has_power = 0` while every leaf beneath
   * them has power, so judging a building by the flag the amenity strip
   * renders would mark twelve entirely-powered buildings unpowered.
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
   * which is the level the assignment was made at (owner ruling 2026-08-07);
   * see `sharingConflictBadge` for why that makes a whole-house let silent.
   *
   * Gated on `isSplitContainer` for the same reason `sharing` above is, and it
   * has to be the same gate: both read `unit.shareability` off this one card,
   * so gating one and not the other would let the LOUDER of the two speak
   * about a unit the quieter one has already ruled is not a slot at all.
   */
  const sharingConflict = isSplitContainer ? null : sharingConflictBadge(unit, overlappingKeys.size)

  /*
   * Whether this card offers to place a family from itself (kindred#2080).
   *
   * ABSENT, NOT DIMMED, in every negative case — mirroring how Hold itself
   * vanishes on an occupied card rather than greying out. That is a signal
   * decision, not a style one: under the board's ruled vocabulary
   * (2026-08-09) `opacity-40` MEANS refusal and is spoken for by the invalid
   * merge target and by a held space. An absent control adds no fifth
   * meaning to any channel.
   *
   * The four gates, and why each is a gate rather than a fit judgement:
   *
   *   - `held` — a hold blocks placement outright (#2087/#2090), and
   *     `resolveDrop` refuses the write. Offering the control would name an
   *     action that writes nothing.
   *   - occupied — Hold's own rule, and the same reasoning: the card that
   *     already holds a family is not the card staff are looking to fill.
   *     A SECOND family still reaches a shareable space by drag, which
   *     remains the path for a share that has to be looked at deliberately.
   *   - `isSplitContainer` — `resolveDrop` rejects one as a target, and it
   *     gets no card anyway; belt-and-braces, exactly as `sharing` above.
   *   - no writer / no `canPlace` — no scenario, or no `bunking.manage`.
   *
   * NOT gated on the list being empty. "Everyone has a cabin" is a real
   * answer to the question the control asks, and the picker says it; hiding
   * the control instead would leave staff wondering where it went.
   */
  const canPickFamily =
    canPlace && onPlaceParty !== undefined && !held && !isSplitContainer && parties.length === 0

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
  // — for an active drop target, or for a held room — would be the two halves
  // of the same mark silently drifting apart.
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
       * `gap-3` is summer's 12px row rhythm (`BunkCard` separates header, bar
       * and roster with `mb-3`). This ran at a flat 8px, which left the title
       * sitting on top of the amenity row.
       */
      className={`card-lodge flex flex-col gap-3 border-t-[3px] p-4 ${cardStateClassName}`}
    >
      <div className="flex items-baseline gap-1.5">
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
            `text-2xl md:text-3xl`, so only the face and tracking carry over. */}
        <h3 className={`truncate text-lg ${openTitleClassName}`}>{unit.name}</h3>
        {/* The tooltip hangs on THIS figure, never on the `<h3>` above it
            (kindred#2177). It is also the smallest trigger on the board, which
            is why `ui/Tooltip` grows a transparent 24px hit target around
            whatever it wraps — a drawn box would collide with the dashed
            border this card already spends on "empty room". */}
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
          {`${occupancyFigure}/${capacityKnown ? String(unit.sleeps) : '—'}`}
        </Tooltip>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {unit.bathroom === 'private' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" /> Private
          </span>
        )}
        {unit.bathroom === 'shared' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" /> Shared
          </span>
        )}
        {unit.has_power === true && <Plug className="h-3 w-3" aria-label="Power" />}
        {unit.has_ac === true && <Snowflake className="h-3 w-3" aria-label="Air conditioning" />}
        {badge && (
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {/* Beside the availability badge because the two answer adjacent
            questions about the same room: whether a family may go in it at
            all, and whether a SECOND one may. */}
        {sharing && (
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${sharing.className}`}>
            {sharing.label}
          </span>
        )}
        {/* kindred#2179. Beside the sharing badge because it answers the same
            question in the one case that badge is deliberately silent on: the
            space says one family, and there are two in it.

            A WARNING, not a refusal — the chip is the whole mark. Nothing here
            touches `useDroppable`, `opacity` or `pointer-events`: the drop
            stays accepted, and `opacity-40` is spoken for by refusal in the
            board's ruled vocabulary. The count is in the tooltip because
            colour alone is not a signal (WCAG 1.4.1) and the icon carries no
            text — and it is a reachable tooltip, not a `title`, since
            kindred#2177. `UnitBadge.title` is optional, so a badge that ever
            arrives without one stays a plain chip rather than becoming a tab
            stop with nothing behind it. */}
        {sharingConflict && <SharingConflictChip badge={sharingConflict} />}
        {/* The only actionable capacity state, and the only one summer's
            four-stop ramp carries that survives at these denominators — a
            room that sleeps two goes green to orange on its second occupant,
            which is a binary wearing four colours. */}
        {overCapacity && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
            Over capacity
          </span>
        )}
        {/* Without this the bare figure reads as overfull whether or not it is
            coloured, which is worse than showing nothing. It says the count
            belongs to a placement wider than this card, not that the room is
            in trouble. */}
        {spanWidth > 0 && (
          <span className="border-border text-muted-foreground rounded-full border px-1.5 py-0.5 text-xs font-medium">
            {`Spans ${String(spanWidth)} rooms`}
          </span>
        )}
        {/* A deactivated room only reaches the board when somebody is still in
            it — hiding it would drop them. */}
        {unit.is_active === false && (
          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            Inactive
          </span>
        )}
        {/* Beside the badge, because the two report the same fact and a card
            that says "Held" in one place and offers to hold it in another says
            two things about one cabin. The control's own children carry
            `w-full`, so the reason line and the open form wrap onto their own
            rows inside this wrapping flex. */}
        <UnitAvailabilityControl
          unit={unit}
          canManage={canSetAvailability && onSetAvailability !== undefined}
          occupied={parties.length > 0}
          isSaving={savingAvailability}
          onSubmit={(write) => {
            onSetAvailability?.(write)
          }}
        />
        {/* kindred#2080 — the space's own placement path, for the staff
            member who has the cabin on screen and not the family.

            Inline and in this row on the owner's ruling (option A): no
            popover, no second surface, literally Hold's shape. Like Hold's
            reason form it carries `w-full`, so it wraps onto its own line of
            this flex row; unlike Hold, it renders its LIST only once the
            search box is engaged, which is what keeps ~82 resting cards from
            growing. */}
        {canPickFamily && (
          <PlaceFamilyPicker
            unit={unit}
            parties={unplacedParties}
            // The registry, only so a combined house is judged by its
            // whole-house capacity rather than by its container row's delta.
            units={units}
            onSelect={(party) => {
              onPlaceParty(unit, party)
            }}
          />
        )}
        {/* Merging is promotion to the parent: dragging this handle onto a
            sibling's card writes `combined: true` on the shared parent. Absent
            entirely on a parentless room — there is nothing to promote it to —
            rather than merely disabled. */}
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
        {/* The inverse control, on the combined card itself.
            `is_container` is part of the gate, not decoration: the API
            resolves `is_combined` for EVERY row, leaves included, so a leaf
            can carry a stale `default_combined: true`. The admin form now
            clears it when "is a building" is unticked, so nothing writes that
            combination any more — but rows saved before it did still hold it
            and no migration went back for them, which is why the gate stays.
            Splitting a room into rooms it does not have is not an operation,
            so the control is absent rather than offered and then failing. */}
        {canMerge &&
          unit.is_container === true &&
          unit.is_combined === true &&
          onSplit !== undefined && (
            <button
              type="button"
              disabled={savingMerge}
              aria-label={`Split ${unit.name} into its rooms`}
              onClick={() => {
                onSplit(unit)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium disabled:opacity-40"
            >
              <Split className="h-3 w-3" />
              Split
            </button>
          )}
      </div>

      {isShared && (
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            consent
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {consent ? (
            <TriangleAlert className="h-3 w-3 flex-shrink-0" />
          ) : (
            <Users className="h-3 w-3 flex-shrink-0" />
          )}
          {`${String(parties.length)} families`}
        </span>
      )}

      {/* Spec §11: a household answered `no_share` and is sharing anyway. On
          2026 data this fires exactly once, and that one case is real. */}
      {consent && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{consent.reason}</p>
      )}

      {/*
        The occupant well — summer's `min-h-[100px]`, and ONE element across
        both branches. Two wells drift; this one cannot.

        `flex-1` is what makes dropping the grid's `items-start` survivable.
        A grid row is already as tall as its tallest card, so stretching the
        cards reclaims no space at all — it moves the whitespace from outside
        the card border to inside it. Without a well that absorbs the extra
        height, stretch just yields 28 blown-up empty cards with the message
        pinned to the top edge, which is worse than the raggedness it fixes.

        `min-h-[100px]` earns its place separately: it lifts an empty card off
        its 139px floor toward the 188px occupied median, so rows start closer
        together before stretch has to do anything.
      */}
      <div className="flex min-h-[100px] flex-1 flex-col gap-2">
        {/* A write-in, drawn where the board draws occupancy (kindred#2078).
            FIRST and unconditionally, never in an either/or with the parties
            below: a card carrying both is not a state any writer produces
            (#2090 rules the two mutually exclusive), but if a legacy row ever
            does, hiding one of them would drop somebody from the board. */}
        {writeIns.map((entry) => (
          <WriteInCard
            key={entry.source.unitId}
            occupant={entry.occupant}
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
                }
              : {})}
            isRemoving={savingAvailability}
          />
        ))}
        {parties.length === 0 && !held ? (
          /* Summer's wording in family vocabulary — `BunkCard` says "Drop
             campers here". An empty slot's job is to be a target, and "Empty"
             described the state without offering the action.

             Only while placement is live, though. Without a scenario or
             without `bunking.manage` there is nothing to drop, so the
             invitation would name an action the reader cannot take. Summer
             renders NOTHING at all in production mode; these cards are small
             enough that a blank body reads as broken rather than read-only, so
             the state is stated instead.

             `m-auto` CENTRES it, where summer top-aligns under `py-8`. A
             deliberate divergence (§4): summer's bunk cards are uniformly
             tall, so a top-aligned message always sits near its own floor.
             These stretch across a 139–357px range, where the same message
             would hang 130px above the bottom of a tall empty card. */
          <p className="text-muted-foreground m-auto text-center text-sm italic">
            {canPlace ? 'Drop families here' : 'Empty'}
          </p>
        ) : (
          parties.map((party) => (
            <FamilyCard
              key={partyKey(party)}
              party={party}
              unit={unit}
              sharedSlot={overlappingKeys.has(partyKey(party))}
              holdsWholeBuilding={wholeBuildingKeys.has(partyKey(party))}
              isDraggable={canPlace}
              onOpen={onOpenParty}
            />
          ))
        )}
      </div>
    </div>
  )
}
