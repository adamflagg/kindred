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
import { overlappingPartyKeys, type BoardSlot } from './boardLayout'
import { isValidMergeTarget, mergeDragId, unitDroppableId } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyKey } from './partyKey'
import { reservationBadge } from './unitBadges'
import { UnitAvailabilityControl } from './UnitAvailabilityControl'

/** What the reserve/release control asks the board to write. */
export interface UnitAvailabilityWrite {
  familyAvailable: boolean | null
  reason: string
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
   * SEPARATE from `canPlace`, which also requires a scenario. Availability
   * carries none since 1500000135, so gating it on one would make a burst pipe
   * unrecordable unless a draft plan happened to be open.
   */
  canSetAvailability?: boolean
  /** True while THIS unit's availability write is in flight. */
  savingAvailability?: boolean
  onSetAvailability?: (unit: LodgingUnitRow, write: UnitAvailabilityWrite) => void
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
  onSplit,
  onMerge,
  savingMerge = false,
  onOpenParty,
}: LodgingUnitCardProps) {
  const { unit, parties, consent } = slot
  const badge = reservationBadge(unit)
  const capacityKnown = unit.sleeps !== null && unit.sleeps !== undefined
  // The "N families" count chip below: a true statement about the CARD
  // regardless of which rooms anyone actually holds, so it stays keyed on
  // the card's whole party count.
  const isShared = parties.length > 1
  // Each FamilyCard's own "did not request sharing" chip, in contrast, must
  // be a true statement about that ONE party — whether it shares a ROOM with
  // somebody, not merely a merged card. Same overlap definition `consentFlag`
  // uses (`overlappingPartyKeys`), passed the same `units` so the container
  // expansion is identical too: the slot flag and the per-card chip can never
  // answer "do these two overlap" two different ways.
  const overlappingKeys = overlappingPartyKeys(parties, units)

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
  // unsuitable one. The fit check is advisory and every cabin is unconfirmed
  // until staff walk the property, so refusing here would block nearly every
  // placement for a reason that is really "nobody has checked yet".
  //
  // Disabled for every card while a MERGE drag is in flight: without this, a
  // card being dragged onto a sibling would sit over two overlapping,
  // simultaneously-enabled droppables — this one and the merge droppable
  // above — and which one dnd-kit resolves `over` to would be a tie decided
  // by hook registration order, not by which gesture is actually in flight.
  const { setNodeRef: setUnitDropRef, isOver: isUnitOver } = useDroppable({
    id: unitDroppableId(unit.code),
    disabled: !canPlace || mergeDragActive,
  })

  const setCardRef = (node: HTMLDivElement | null) => {
    setUnitDropRef(node)
    setMergeDropRef(node)
  }

  return (
    <div
      data-unit-card
      data-unit-code={unit.code}
      ref={setCardRef}
      style={{ borderTopColor: hue }}
      /*
       * `.card-lodge` is summer's card chrome, not a lookalike — the same
       * class `BunkCard` wears (CLAUDE.md §4, "Family Camp Models Summer").
       * It carries `bg-card`, `rounded-2xl`, a 2px border, the two-layer
       * lodge shadow and the hover lift. This card used to hand-roll
       * `bg-card rounded-xl border`, which is the same idea minus the shadow
       * and the hover — so it read as a table row rather than a card.
       *
       * ORDER MATTERS BELOW. `.card-lodge` lives in `@layer components`, so
       * every utility here outranks it whatever the string order: the amber
       * consent edge, the empty-slot wash and the drop-target ring all still
       * land. The hue top edge is an inline style and outranks both, which is
       * what keeps §3.10's secondary channel through `card-lodge`'s own
       * `border-border` and its `border-primary/50` hover.
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
      className={`card-lodge flex flex-col gap-3 border-t-[3px] p-4 ${
        consent ? 'border-amber-400 ring-1 ring-amber-400/40 dark:border-amber-500' : ''
      } ${parties.length === 0 ? 'bg-muted/25 border-dashed' : ''} ${
        isUnitOver || isMergeOver ? 'border-primary ring-primary/50 bg-primary/5 ring-2' : ''
      } ${
        // Invalid targets grey out mid-drag, as summer's `isValidDropTarget()`
        // does for gender. Gated on `mergeDragActive` too: with no card drag
        // in flight `isValidTarget` is trivially false for every card, and
        // without this guard the whole board would sit permanently dimmed.
        mergeDragActive && !isValidTarget ? 'pointer-events-none opacity-40' : ''
      }`}
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
        <h3 className="text-foreground truncate text-lg font-semibold">{unit.name}</h3>
        <span
          title={capacityKnown ? `Sleeps ${String(unit.sleeps)}` : 'Capacity not recorded'}
          className="text-muted-foreground ml-auto text-sm tabular-nums"
        >
          {capacityKnown ? String(unit.sleeps) : '—'}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {unit.bathroom === 'private' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" aria-hidden="true" /> Private
          </span>
        )}
        {unit.bathroom === 'shared' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" aria-hidden="true" /> Shared
          </span>
        )}
        {unit.has_power === true && <Plug className="h-3 w-3" aria-label="Power" />}
        {unit.has_ac === true && <Snowflake className="h-3 w-3" aria-label="Air conditioning" />}
        {badge && (
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
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
          isSaving={savingAvailability}
          onSubmit={(write) => {
            onSetAvailability?.(unit, write)
          }}
        />
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
            className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex cursor-grab items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium active:cursor-grabbing disabled:opacity-40"
          >
            <Merge className="h-3 w-3" aria-hidden="true" />
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
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40"
            >
              <Split className="h-3 w-3" aria-hidden="true" />
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
            <TriangleAlert className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
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
        {parties.length === 0 ? (
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
              isDraggable={canPlace}
              onOpen={onOpenParty}
            />
          ))
        )}
      </div>
    </div>
  )
}
