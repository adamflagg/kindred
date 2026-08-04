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
 * 1. is_active and inventory_class are ALWAYS submitted. PocketBase has
 *    no per-field default for bool or select, and `required: true` on a bool
 *    means "must be true", so neither can be required in the schema. A create
 *    that omits them yields `is_active = false, inventory_class = ''`:
 *    a unit no list query returns, which also matches neither branch of the
 *    family-availability rules.
 *
 * 2. A blank number field submits NO key ON CREATE, so PocketBase writes its
 *    own 0. PocketBase cannot store NULL in a number column, so 0 is the only
 *    "unset" it has. ON EDIT the rule inverts for `sleeps`: omitting the key
 *    leaves the previous number in place, which makes clearing the field a
 *    silent no-op, so the edit path sends an explicit 0 — the stored spelling
 *    of UNKNOWN. `map_x` / `map_y` stay omit-on-blank in both directions;
 *    they carry no UNKNOWN semantics a consumer reads.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingUnit, updateLodgingUnit } from '../../../services/lodgingCrud'
import { normaliseBeds } from '../../../types/beds'
import type {
  InventoryClassValue,
  LodgingAreaRecord,
  LodgingUnitInput,
  LodgingUnitRecord,
} from '../../../types/lodging'
import { amenitiesOf } from './unitAmenities'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL, SECTION } from './lodgingStyles'
import { parseSleeps } from './sleepsValue'
import { slugify } from './unitCode'
import { directChildren } from './unitTree'
import { UnitAmenityFieldset } from './UnitAmenityFieldset'
import { UnitCapacityFields } from './UnitCapacityFields'
import { UnitIdentityFields } from './UnitIdentityFields'
import { UnitMapFields } from './UnitMapFields'

export interface LodgingUnitFormProps {
  areas: LodgingAreaRecord[]
  /**
   * Every unit — for the parent picker (see ./unitTree) and to know whether
   * the unit being edited currently has children, which gates `is_container`
   * below.
   */
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
  const [inventoryClass, setInventoryClass] = useState<InventoryClassValue>(
    unit?.inventory_class === 'staff_default' ? 'staff_default' : 'family_pool'
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [notes, setNotes] = useState(unit?.notes ?? '')
  const [isSaving, setIsSaving] = useState(false)
  // Untying this unit's children from it would leave them parented by a
  // non-container — the exact state verify-lodging-seed.sh calls a failure.
  const children = unit ? directChildren(unit.id, units) : []

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    // Shared with the capacity flag — see ./sleepsValue. Both must read the
    // field the same way or the flag comments on a number this never saves.
    const parsedSleeps = parseSleeps(capacity.sleeps)
    const parsedMapX = Number.parseFloat(map.x)
    const parsedMapY = Number.parseFloat(map.y)
    // `code` is the join key both `bathroom_group` membership and the roster's
    // `unit_code` match on. slugify keeps only [a-z0-9], so a name with no
    // ASCII alphanumerics derives to '' — an empty join key matches nothing
    // and does so silently, which is worse than refusing the save. The code
    // disclosure is the way out, and it already shows staff what will be used.
    const code = identity.code.trim() === '' ? slugify(identity.name) : identity.code.trim()
    if (code === '') {
      toast.error('This name produces no usable code. Open “set it manually” and enter one.')
      setIsSaving(false)
      return
    }
    const payload: LodgingUnitInput = {
      area: identity.area,
      name: identity.name,
      code,
      parent_unit: identity.parent_unit,
      // Never omitted — see the header comment.
      is_active: isActive,
      inventory_class: inventoryClass,
      is_container: isContainer,
      notes,
      beds: capacity.beds,
      ...amenities,
      // Create omits it so PocketBase writes its own 0. Edit sends an explicit
      // 0, because 0 IS the stored representation of UNKNOWN — omitting the
      // key would leave the previous number in place and make clearing the
      // field a silent no-op the staffer believes worked.
      ...(parsedSleeps === null ? (unit ? { sleeps: 0 } : {}) : { sleeps: parsedSleeps }),
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

      {/* is_confirmed and is_container are read LIVE rather than off `unit`:
          both silence the capacity flag, and a staffer who has just ticked
          either has already made the ruling the flag would be asking for. */}
      <UnitCapacityFields
        value={capacity}
        onChange={setCapacity}
        isConfirmed={amenities.is_confirmed}
        isContainer={isContainer}
      />

      <UnitAmenityFieldset value={amenities} onChange={setAmenities} />

      <p className={SECTION}>Availability</p>

      <label className="text-sm">
        <span className={LABEL}>Allocation</span>
        {/* No blank option: an empty inventory_class matches neither
            branch of the family-availability rules. */}
        <select
          className={FIELD}
          value={inventoryClass}
          onChange={(e) => {
            setInventoryClass(e.target.value as InventoryClassValue)
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
            disabled={children.length > 0}
            onChange={(e) => {
              setIsContainer(e.target.checked)
            }}
          />
          This row is a building or floor, not a bookable room
        </label>
        {children.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Can&apos;t be unticked — {children.length} unit{children.length === 1 ? '' : 's'} list
            this as their parent.
          </p>
        )}
      </div>

      <UnitMapFields value={map} onChange={setMap} />

      {/* Its own section, or it reads as a note about the map coordinates
          above it. The field's label is for assistive tech only — the heading
          is already the visible one, and two would be the same word twice. */}
      <p className={SECTION}>Notes</p>

      <label className="text-sm sm:col-span-2">
        <span className="sr-only">Notes</span>
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
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY}>
          {unit ? 'Save unit' : 'Create unit'}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  )
}
