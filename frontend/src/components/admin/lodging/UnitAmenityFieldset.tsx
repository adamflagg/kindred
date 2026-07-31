/**
 * Everything "Amenities confirmed by staff" asserts, in one place.
 *
 * The confirm checkbox closes the section rather than sitting with Active,
 * because what it confirms is exactly the controls above it. While it is false
 * the roster reports "fit not verified" rather than reading an unset amenity
 * as a "no", so this checkbox is what switches the fit check on for a cabin.
 */
import type { BathroomStoredValue } from '../../../types/lodging'
import { AMENITY_FLAGS, type UnitAmenities } from './unitAmenities'
import { FIELD, LABEL, SECTION } from './unitFormFields'

export interface UnitAmenityFieldsetProps {
  value: UnitAmenities
  onChange: (next: UnitAmenities) => void
}

export function UnitAmenityFieldset({ value, onChange }: UnitAmenityFieldsetProps) {
  return (
    <>
      <p className={SECTION}>Amenities</p>

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
        <span className={LABEL}>Bathroom group</span>
        <input
          className={FIELD}
          value={value.bathroom_group}
          placeholder="Units sharing one bathroom carry the same id"
          onChange={(e) => {
            onChange({ ...value, bathroom_group: e.target.value })
          }}
        />
      </label>

      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:col-span-2">
        <legend className="sr-only">Amenity flags</legend>
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
              <Icon className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
              {flag.label}
            </label>
          )
        })}
        <label className="border-border/60 inline-flex items-center gap-2 border-l pl-5 font-medium">
          <input
            type="checkbox"
            checked={value.is_confirmed}
            onChange={(e) => {
              onChange({ ...value, is_confirmed: e.target.checked })
            }}
          />
          Amenities confirmed by staff
        </label>
      </fieldset>
    </>
  )
}
