/**
 * What the cabin has, and the one assertion staff make over all of it.
 *
 * The flags render as a FIXED grid rather than a wrapping row. A flex-wrap
 * reflows to a different shape at every width, so the same ten controls landed
 * in a different arrangement each time the panel was opened — nothing sat
 * where it sat last time, which is what made the section feel unordered even
 * though the list never changed. Columns hold their position.
 *
 * `is_confirmed` is NOT rendered here. It is an assertion OVER these ten, not
 * an eleventh peer — "a human has walked this cabin and checked them" — so it
 * belongs beside Save, where the form's other commitments live. It stopped
 * gating the roster's judgement under kindred#2526; it is the reconfirm
 * work-down list, and it is still an assertion over the whole set.
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import type {
  BathroomStoredValue,
  InventoryClassValue,
  LodgingUnitRecord,
  ShareabilityStoredValue,
} from '../../../types/lodging'
import { shareabilityDrift } from './shareabilityDrift'
import { AMENITY_FLAGS, type UnitAmenities } from './unitAmenities'
import { ACTION_LINK, BUTTON_SECONDARY, FIELD, FIELD_INLINE, LABEL } from './lodgingStyles'

/**
 * How each classification is said in a sentence, so the advisory reads as
 * English rather than as two column values. Deliberately the SAME words as the
 * options above — a staffer must be able to match the message to the control
 * without translating.
 */
const SHAREABILITY_WORDING = {
  shareable: 'two or more families may share',
  single_party: 'one family only',
} as const

export interface UnitAmenityFieldsetProps {
  value: UnitAmenities
  onChange: (next: UnitAmenities) => void
  /**
   * Every group id already in use, deduplicated and sorted — the datalist for
   * the RAW-ID fallback below, which a parentless unit still gets.
   */
  bathroomGroups: string[]
  /**
   * The unit's parent, or undefined when it has none.
   *
   * This is what switches the bathroom-share field between its two forms. The
   * chips name the other rooms UNDER THE SAME PARENT, so a unit with no parent
   * has no candidate list to offer and keeps the raw-id input. Zero parentless
   * units carry a group in production, so the "same area" fallback the
   * proposal sketched would be a branch no real row exercises; the raw field
   * is the honest thing to leave in its place.
   */
  shareParent: LodgingUnitRecord | undefined
  /** The rooms currently in this unit's bathroom group. Rendered as chips. */
  sharePeers: LodgingUnitRecord[]
  /** Rooms that may still be added. EMPTY IS THE COMMON CASE — see below. */
  shareCandidates: LodgingUnitRecord[]
  onAddSharePeer: (unitId: string) => void
  onRemoveSharePeer: (unitId: string) => void
  /**
   * Separate from `value` on purpose — see the note in `unitAmenities.ts`.
   * Shareability is a policy classification the board trusts immediately, not
   * an amenity gated behind the `is_confirmed` checkbox that governs
   * everything in `UnitAmenities`. It renders here and only here.
   */
  shareability: ShareabilityStoredValue
  onShareabilityChange: (next: ShareabilityStoredValue) => void
  /**
   * Live form values, not the stored row, so the advisory below reacts as the
   * staffer types rather than at the next reload — the same discipline
   * `UnitCapacityFields` uses for its own flag.
   */
  inventoryClass: InventoryClassValue | ''
  isContainer: boolean
}

export function UnitAmenityFieldset({
  value,
  onChange,
  bathroomGroups,
  shareParent,
  sharePeers,
  shareCandidates,
  onAddSharePeer,
  onRemoveSharePeer,
  shareability,
  onShareabilityChange,
  inventoryClass,
  isContainer,
}: UnitAmenityFieldsetProps) {
  const drift = shareabilityDrift({ inventoryClass, isContainer, stored: shareability })
  const [pendingPeer, setPendingPeer] = useState('')
  // The candidate list SHRINKS as rooms are added, so a held selection goes
  // stale — and a `<select>` whose value is not among its options renders
  // blank while the stale value rides through to the next click. Same trap
  // `parentCandidates` documents for the parent picker; same answer.
  const selectedPeer = shareCandidates.some((room) => room.id === pendingPeer)
    ? pendingPeer
    : (shareCandidates[0]?.id ?? '')
  const nothingLeftToAdd = shareCandidates.length === 0
  // A group nobody else is in. This is the state a mistyped id produced and
  // the state this control exists to make visible — but it is only worth
  // saying while it is the STORED truth, not mid-edit as the last chip comes
  // off, where the save is about to clear both records anyway.
  const groupOfOne = sharePeers.length === 0 && value.bathroom_group !== ''

  return (
    <>
      <label className="text-sm">
        <span className={LABEL}>Bathroom</span>
        {/* These are the STORED values. The API's `unknown` token is not one
            of them — writing it back would fail the select's validation. */}
        <select
          className={FIELD}
          value={value.bathroom}
          onChange={(e) => {
            onChange({ ...value, bathroom: e.target.value as BathroomStoredValue })
          }}
        >
          <option value="">Unknown</option>
          <option value="none">None (bathhouse walk)</option>
          <option value="private">Private</option>
          <option value="shared">Shared</option>
        </select>
      </label>

      {/* THE QUESTION A STAFFER IS ACTUALLY ANSWERING is "which other rooms
          share this bathroom?" (kindred#2023), so the field asks that. The
          group id — a slug vocabulary nobody outside this table has any reason
          to know, and which nothing validated — stays in storage, unchanged,
          where the merged-pair scoring path (#2022, #2170) reads it.

          STILL IN ITS HALF-WIDTH CELL. Widening it would strand the Bathroom
          select against a visible hole, which is the arrangement this file's
          own header made a fixed grid to prevent. The chips wrap instead.

          Chip grammar is `BedInventoryEditor`'s, class for class — two chip
          fields in one modal that did not match would read as two products. */}
      {shareParent === undefined ? (
        <label className="text-sm">
          <span className={LABEL}>Shares a bathroom with</span>
          {/* NO PARENT, NO SIBLINGS TO NAME. Zero units in production are in
              this state while carrying a group, so a "same area" candidate
              list would be a branch no real row exercises. The raw id keeps
              working, unchanged, rather than being replaced by an untested
              guess. */}
          <input
            className={FIELD}
            list="bathroom-group-options"
            value={value.bathroom_group}
            placeholder="Same id on every unit sharing it"
            onChange={(e) => {
              onChange({ ...value, bathroom_group: e.target.value })
            }}
          />
          <datalist id="bathroom-group-options">
            {bathroomGroups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </label>
      ) : (
        <div className="text-sm">
          <span className={LABEL} id="bathroom-share-label">
            Shares a bathroom with
          </span>
          <ul
            className="flex flex-wrap items-center gap-1.5"
            aria-labelledby="bathroom-share-label"
          >
            {sharePeers.map((peer) => (
              <li
                key={peer.id}
                className="border-border bg-muted/40 inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-sm"
              >
                <span className="whitespace-nowrap">{peer.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${peer.name}`}
                  onClick={() => {
                    onRemoveSharePeer(peer.id)
                  }}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full p-1 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}

            {/* In the same wrap as the chips, so adding a room reads as
                extending the set rather than operating a separate control.

                DISABLED IS THE ORDINARY STATE, not an edge case: nine of the
                ten groups on site already cover every room under their parent,
                so there is usually nothing left to add. It takes
                BUTTON_SECONDARY's own `disabled:opacity-50` — the admin form's
                idiom — and deliberately NOT opacity-40, which the weekend
                board reserves for its refusal signal. */}
            <li className="inline-flex items-center gap-1.5">
              <select
                aria-label="Add a room that shares this bathroom"
                className={`${FIELD_INLINE} py-1 disabled:opacity-50`}
                value={selectedPeer}
                disabled={nothingLeftToAdd}
                onChange={(e) => {
                  setPendingPeer(e.target.value)
                }}
              >
                {nothingLeftToAdd ? (
                  <option value="">No rooms left</option>
                ) : (
                  shareCandidates.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                disabled={nothingLeftToAdd}
                onClick={() => {
                  if (selectedPeer !== '') onAddSharePeer(selectedPeer)
                }}
                className={`${BUTTON_SECONDARY} px-2.5 py-1`}
              >
                <Plus className="h-3.5 w-3.5" />
                Add room
              </button>
            </li>
          </ul>
          {/* Amber, matching the Sharing drift advisory below, because this
              one IS a warning: a group nobody else is in is the state a
              mistyped id produced, and the roster will not match a family on
              it. The clear action is not a nicety — the chips have no other
              way to empty a stale group id, which the raw text field could
              always do, and losing that would be a regression. */}
          {groupOfOne && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              No other room shares this bathroom, so nothing is shared.{' '}
              <button
                type="button"
                className={ACTION_LINK}
                onClick={() => {
                  onChange({ ...value, bathroom_group: '' })
                }}
              >
                Clear it
              </button>
            </p>
          )}
          {/* Muted, NOT amber — nine of the ten groups on site are in exactly
              this state, so colouring it as a warning would report the
              healthiest possible group as a problem. */}
          {nothingLeftToAdd && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              {sharePeers.length > 0
                ? `Every other room in ${shareParent.name} is already listed.`
                : `${shareParent.name} has no other room to share with.`}
            </p>
          )}
        </div>
      )}

      {/* Full width rather than a third half-width control. This fragment's
          items are direct children of the form's `sm:grid-cols-2` grid, and
          the next sibling (Features) is `sm:col-span-2` and cannot back-fill,
          so a third narrow control would sit alone against a visible hole —
          in a section this file's own header made a fixed grid precisely so
          that nothing would move around between openings. */}
      <label className="text-sm sm:col-span-2">
        <span className={LABEL}>Sharing</span>
        {/* THE BLANK OPTION IS NOT DECORATION. It is what makes "nobody has
            classified this" answerable, which is the whole reason the column
            is a select rather than a bool: unrecorded must be distinguishable
            from "one family only", and must never read as permission to
            double-book. Contrast the Allocation select above, which has no
            blank option because an empty inventory_class matches neither
            branch of the availability rules — there, blank is meaningless;
            here it is a state 1500000145 deliberately leaves rows in when it
            cannot honestly classify them.

            Wording is the staff question, not the column name: a staffer
            deciding this is asking whether two families can go in the room. */}
        <select
          className={FIELD}
          value={shareability}
          onChange={(e) => {
            onShareabilityChange(e.target.value as ShareabilityStoredValue)
          }}
        >
          <option value="">Not classified</option>
          <option value="shareable">Two or more families may share</option>
          <option value="single_party">One family only</option>
        </select>
        {/* No AT users here (frontend/CLAUDE.md "Accessibility —
            deliberately minimal"), so this stays plain text — no
            aria-live/role="status" (kindred#2379). */}
        <div>
          {drift && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              {`This is set to ${SHAREABILITY_WORDING[drift.stored]}, but the unit as edited reads ${SHAREABILITY_WORDING[drift.derived]}.`}
            </p>
          )}
        </div>
      </label>

      <fieldset className="sm:col-span-2">
        <legend className={LABEL}>Features</legend>
        {/* Two up on a phone, four on the modal's real width. The icons are
            the same glyphs the units table renders per row, so a staffer
            learns one vocabulary rather than one per surface. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {AMENITY_FLAGS.map((flag) => {
            const Icon = flag.icon
            return (
              <label key={flag.key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value[flag.key]}
                  onChange={(e) => {
                    onChange({ ...value, [flag.key]: e.target.checked })
                  }}
                />
                <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{flag.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}
