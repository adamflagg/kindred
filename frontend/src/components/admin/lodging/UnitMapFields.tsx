/**
 * Where the unit sits on the camp map, as a 0–1 fraction of the image.
 *
 * Not decorative: a later phase draws the site from these coordinates, which
 * is where "is this family next to a bathhouse" gets answered (spec §7.2b).
 * Blank means unplaced, and an unplaced unit submits no coordinate at all
 * rather than pinning itself to the map's top-left corner.
 *
 * `step="any"` IS THE FIX FOR A REAL BUG, not a loosening. A numeric `step`
 * makes the browser reject any value that is not a multiple of it, and that
 * rejection blocks submission of the WHOLE form. These coordinates come from a
 * placement pass, not from typing: 62 of the 114 units carry four decimal
 * places, so a step of 0.001 made the majority of units unsavable — a staffer
 * could not confirm a cabin's amenities without first truncating a coordinate
 * they never meant to touch, which silently moves the unit on the map.
 *
 * `min`/`max` stay: the range is a real constraint the column shares, and it
 * is the precision grid that was wrong, never the bounds.
 */
import { FIELD, LABEL, SECTION } from './lodgingStyles'

export interface UnitMapPosition {
  x: string
  y: string
}

export interface UnitMapFieldsProps {
  value: UnitMapPosition
  onChange: (next: UnitMapPosition) => void
}

export function UnitMapFields({ value, onChange }: UnitMapFieldsProps) {
  return (
    <>
      <p className={SECTION}>Map position</p>

      <label className="text-sm">
        <span className={LABEL}>Map X</span>
        <input
          className={FIELD}
          type="number"
          step="any"
          min={0}
          max={1}
          value={value.x}
          placeholder="0–1"
          onChange={(e) => {
            onChange({ ...value, x: e.target.value })
          }}
        />
      </label>

      <label className="text-sm">
        <span className={LABEL}>Map Y</span>
        <input
          className={FIELD}
          type="number"
          step="any"
          min={0}
          max={1}
          value={value.y}
          placeholder="0–1"
          onChange={(e) => {
            onChange({ ...value, y: e.target.value })
          }}
        />
      </label>
    </>
  )
}
