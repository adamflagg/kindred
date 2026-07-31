/**
 * Create/edit one lodging unit.
 *
 * The fields live in sections — identity, capacity, amenities, availability,
 * map position — each its own component. This file owns only the state those
 * sections edit and the one payload they add up to.
 *
 * TWO THINGS THIS FORM EXISTS TO GET RIGHT (the third, `sleeps`, is in
 * `UnitCapacityFields`; the bathroom vocabulary is in `unitAmenities`):
 *
 * 1. is_active and allocation_default are ALWAYS submitted. PocketBase has
 *    no per-field default for bool or select, and `required: true` on a bool
 *    means "must be true", so neither can be required in the schema. A create
 *    that omits them yields `is_active = false, allocation_default = ''`:
 *    a unit no list query returns, which also matches neither branch of the
 *    family-availability rules.
 *
 * 2. A blank number field submits NO key rather than a 0. PocketBase cannot
 *    store NULL in a number column, so 0 is the only "unset" it has — and
 *    sending an explicit 0 would overwrite a real value with a false one.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingUnit, updateLodgingUnit } from '../../../services/lodgingCrud'
import { normaliseBeds } from '../../../types/beds'
import type {
  AllocationDefaultValue,
  LodgingAreaRecord,
  LodgingUnitInput,
  LodgingUnitRecord,
} from '../../../types/lodging'
import { amenitiesOf } from './unitAmenities'
import { FIELD, LABEL, SECTION, slugify } from './unitFormFields'
import { UnitAmenityFieldset } from './UnitAmenityFieldset'
import { UnitCapacityFields } from './UnitCapacityFields'
import { UnitIdentityFields } from './UnitIdentityFields'
import { UnitMapFields } from './UnitMapFields'

export interface LodgingUnitFormProps {
  areas: LodgingAreaRecord[]
  /** Every unit, for the parent picker. A unit may not be its own parent. */
  units: LodgingUnitRecord[]
  /** Absent = create. `| undefined` is explicit for `exactOptionalPropertyTypes`. */
  unit?: LodgingUnitRecord | undefined
  onSaved: () => void
  onCancel: () => void
}

export function LodgingUnitForm({ areas, units, unit, onSaved, onCancel }: LodgingUnitFormProps) {
  const [identity, setIdentity] = useState({
    name: unit?.name ?? '',
    code: unit?.code ?? '',
    area: unit?.area ?? areas[0]?.id ?? '',
    parent_unit: unit?.parent_unit ?? '',
  })
  const [capacity, setCapacity] = useState({
    // A stored 0 means UNKNOWN, so it maps to an empty input.
    sleeps: unit && unit.sleeps > 0 ? String(unit.sleeps) : '',
    beds: normaliseBeds(unit?.beds),
  })
  const [amenities, setAmenities] = useState(amenitiesOf(unit))
  const [map, setMap] = useState({
    x: unit ? String(unit.map_x) : '',
    y: unit ? String(unit.map_y) : '',
  })
  const [allocation, setAllocation] = useState<AllocationDefaultValue>(
    unit?.allocation_default === 'staff_default' ? 'staff_default' : 'family_pool'
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [notes, setNotes] = useState(unit?.notes ?? '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    const parsedSleeps = Number.parseInt(capacity.sleeps, 10)
    const parsedMapX = Number.parseFloat(map.x)
    const parsedMapY = Number.parseFloat(map.y)
    const payload: LodgingUnitInput = {
      area: identity.area,
      name: identity.name,
      code: identity.code.trim() === '' ? slugify(identity.name) : identity.code.trim(),
      parent_unit: identity.parent_unit,
      // Never omitted — see the header comment.
      is_active: isActive,
      allocation_default: allocation,
      is_container: isContainer,
      notes,
      beds: capacity.beds,
      ...amenities,
      ...(Number.isNaN(parsedSleeps) ? {} : { sleeps: parsedSleeps }),
      ...(Number.isNaN(parsedMapX) ? {} : { map_x: parsedMapX }),
      ...(Number.isNaN(parsedMapY) ? {} : { map_y: parsedMapY }),
    }
    try {
      if (unit) {
        await updateLodgingUnit(unit.id, payload)
      } else {
        await createLodgingUnit(payload)
      }
      toast.success(unit ? 'Unit saved' : 'Unit created')
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save the unit')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-3 sm:grid-cols-2">
      <UnitIdentityFields
        value={identity}
        onChange={setIdentity}
        areas={areas}
        units={units}
        unitId={unit?.id}
      />

      <UnitCapacityFields value={capacity} onChange={setCapacity} />

      <UnitAmenityFieldset value={amenities} onChange={setAmenities} />

      <p className={SECTION}>Availability</p>

      <label className="text-sm">
        <span className={LABEL}>Allocation</span>
        {/* No blank option: an empty allocation_default matches neither
            branch of the family-availability rules. */}
        <select
          className={FIELD}
          value={allocation}
          onChange={(e) => {
            setAllocation(e.target.value as AllocationDefaultValue)
          }}
        >
          <option value="family_pool">Available to guests</option>
          <option value="staff_default">Held for staff</option>
        </select>
      </label>

      <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => {
              setIsActive(e.target.checked)
            }}
          />
          Active
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isContainer}
            onChange={(e) => {
              setIsContainer(e.target.checked)
            }}
          />
          This row is a building or floor, not a bookable room
        </label>
      </div>

      <UnitMapFields value={map} onChange={setMap} />

      <label className="text-sm sm:col-span-2">
        <span className={LABEL}>Notes</span>
        <textarea
          className={FIELD}
          rows={2}
          value={notes}
          placeholder="Shared kitchen and living room; bathroom off the lobby…"
          onChange={(e) => {
            setNotes(e.target.value)
          }}
        />
      </label>

      <div className="border-border/60 mt-1 flex gap-2 border-t pt-3 sm:col-span-2">
        <button
          type="submit"
          disabled={isSaving}
          className="bg-primary text-primary-foreground shadow-lodge-sm rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
        >
          {unit ? 'Save unit' : 'Create unit'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
