/**
 * Where the unit sits on the camp map, as a 0–1 fraction of the image.
 *
 * Not decorative: a later phase draws the site from these coordinates, which
 * is where "is this family next to a bathhouse" gets answered (spec §7.2b).
 * Blank means unplaced, and an unplaced unit submits no coordinate at all
 * rather than pinning itself to the map's top-left corner.
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
          step="0.001"
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
          step="0.001"
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
