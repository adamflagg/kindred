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
 * an eleventh peer, and it is the switch that makes the roster judge a
 * family's housing need against this cabin at all — so it belongs beside Save,
 * where the form's other commitments live.
 */
import type {
  BathroomStoredValue,
  InventoryClassValue,
  ShareabilityStoredValue,
} from '../../../types/lodging'
import { shareabilityDrift } from './shareabilityDrift'
import { AMENITY_FLAGS, type UnitAmenities } from './unitAmenities'
import { FIELD, LABEL } from './lodgingStyles'

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
  /** Every group id already in use, deduplicated and sorted. */
  bathroomGroups: string[]
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
  sleeps: string
}

export function UnitAmenityFieldset({
  value,
  onChange,
  bathroomGroups,
  shareability,
  onShareabilityChange,
  inventoryClass,
  isContainer,
  sleeps,
}: UnitAmenityFieldsetProps) {
  const drift = shareabilityDrift({ inventoryClass, isContainer, sleeps, stored: shareability })

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

      <label className="text-sm">
        <span className={LABEL}>Shares a bathroom with</span>
        {/* Units share a bathroom by carrying the SAME string, and nothing
            validates it — one typo makes a group of one and the roster stops
            matching that family on a shared bathroom, with no error anywhere.
            A datalist makes the common case a choice rather than a spelling
            test, and still lets a new group be typed. */}
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
        {/* ALWAYS MOUNTED, and wrapping the visible text rather than duplicating
            it — the same two constraints `UnitCapacityFields` documents at
            length for its own advisory. A live region is only announced when
            its contents change while it is already in the document, so
            rendering the region together with its text is missed by several
            screen readers; and an sr-only second copy would be read twice by
            anyone navigating the form linearly. */}
        <div role="status" aria-live="polite" aria-label="Sharing advisory">
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
