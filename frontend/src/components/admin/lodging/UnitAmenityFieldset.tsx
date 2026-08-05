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
import type { BathroomStoredValue } from '../../../types/lodging'
import { AMENITY_FLAGS, type UnitAmenities } from './unitAmenities'
import { FIELD, LABEL } from './lodgingStyles'

export interface UnitAmenityFieldsetProps {
  value: UnitAmenities
  onChange: (next: UnitAmenities) => void
}

export function UnitAmenityFieldset({ value, onChange }: UnitAmenityFieldsetProps) {
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
        <input
          className={FIELD}
          value={value.bathroom_group}
          placeholder="Same id on every unit sharing it"
          onChange={(e) => {
            onChange({ ...value, bathroom_group: e.target.value })
          }}
        />
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
