/**
 * Create/edit one lodging unit.
 *
 * The fields live in sections — identity, capacity, amenities, availability —
 * each its own component. This file owns only the state those sections edit
 * and the one payload they add up to.
 *
 * THREE THINGS THIS FORM EXISTS TO GET RIGHT (`sleeps` itself lives in
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
 *    of UNKNOWN.
 *
 *    `sleeps` is the ONLY field with an omission rule, because it is the only
 *    one here whose blank means something. `map_x` / `map_y` used to be the
 *    other half of this paragraph; they are no longer edited on this form at
 *    all, and a stored coordinate now survives a save because the key is
 *    UNCONDITIONALLY ABSENT — not because a guard omits it when blank. Anyone
 *    wiring the map editor back in has to add that guard, not assume it.
 *
 * 3. The season is captured WHEN THE EDITOR OPENS, not read live. Units are
 *    year-scoped since 1500000140 and this form always submits `year`, so a
 *    live read would let a season flip mid-edit — another tab, a
 *    CurrentYearContext refetch — move the cabin into the new season on the
 *    next save. Roll-forward moves a unit between seasons; a routine edit
 *    never does.
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
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from './lodgingStyles'
import { parseSleeps } from './sleepsValue'
import { slugify } from './unitCode'
import { directChildren } from './unitTree'
import { UnitAmenityFieldset } from './UnitAmenityFieldset'
import { UnitCapacityFields } from './UnitCapacityFields'
import { UnitIdentityFields } from './UnitIdentityFields'

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
  /**
   * The season the editor opened against. Units are year-scoped since
   * 1500000140, and this form always writes it — on create because the schema
   * requires it (an omitted number field lands as 0, which fails `min: 2010`),
   * and on edit because `unit` is one of that season's rows already.
   *
   * CAPTURED AT MOUNT, not read live (see the header). This form never changes
   * which season a unit belongs to — that is a roll-forward operation, not a
   * routine edit — and capturing is what makes that true rather than intended.
   */
  year: number
  onSaved: () => void
  onCancel: () => void
}

/**
 * What PocketBase actually refused, rather than that it refused.
 *
 * The SDK's top-level `message` on a validation failure is "Failed to create
 * record." — true and useless. The part a staffer can act on is per-FIELD,
 * under `response.data`, and `code` is the one that bites: it carries a UNIQUE
 * index, so a collision with an existing unit is rejected here and nowhere
 * else. Without this, that rejection is a red toast with no reason and a form
 * that will not submit however many times it is tried.
 */
function saveErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, { message?: string }> } })?.response
    ?.data
  if (data && typeof data === 'object') {
    const named = Object.entries(data)
      .filter(([, detail]) => typeof detail?.message === 'string')
      .map(([field, detail]) => `${field}: ${detail.message ?? ''}`)
    if (named.length > 0) return named.join(' · ')
  }
  return error instanceof Error ? error.message : 'Failed to save the unit'
}

export function LodgingUnitForm({
  areas,
  units,
  unit,
  year,
  onSaved,
  onCancel,
}: LodgingUnitFormProps) {
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
  const [inventoryClass, setInventoryClass] = useState<InventoryClassValue>(
    unit?.inventory_class === 'staff_default' ? 'staff_default' : 'family_pool'
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [notes, setNotes] = useState(unit?.notes ?? '')
  const [isSaving, setIsSaving] = useState(false)
  // Captured, not read live — see the `year` prop's doc comment above.
  const [openedYear] = useState(year)
  // Untying this unit's children from it would leave them parented by a
  // non-container — the exact state verify-lodging-seed.sh calls a failure.
  const children = unit ? directChildren(unit.id, units) : []
  // Derived from the units already in hand, so no extra fetch and no second
  // source of truth about which groups exist.
  const bathroomGroups = [
    ...new Set(units.map((u) => u.bathroom_group).filter((g) => g !== '')),
  ].sort((a, b) => a.localeCompare(b))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    // Shared with the capacity flag — see ./sleepsValue. Both must read the
    // field the same way or the flag comments on a number this never saves.
    const parsedSleeps = parseSleeps(capacity.sleeps)
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
      year: openedYear,
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
      toast.error(saveErrorMessage(error))
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
        inventoryClass={inventoryClass}
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

      <UnitAmenityFieldset
        value={amenities}
        onChange={setAmenities}
        bathroomGroups={bathroomGroups}
      />

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
          In use
        </label>
        {/* Retiring is the ONLY way to take a cabin out of circulation:
            guardUnitDelete refuses to delete a unit any placement references,
            and points here. "Active" never said that, so the only route a
            staffer could see was the one the server rejects. */}
        <p className="text-muted-foreground pl-6 text-xs">
          Uncheck to retire a cabin. It stops appearing for housing, and past housing records are
          kept.
        </p>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isContainer}
            disabled={children.length > 0}
            onChange={(e) => {
              setIsContainer(e.target.checked)
            }}
          />
          This is a building or building area with multiple bedrooms.
        </label>
        {children.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Can&apos;t be unticked — {children.length} unit{children.length === 1 ? '' : 's'} list
            this as their parent.
          </p>
        )}
      </div>

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

      <div className="border-border/60 mt-1 flex flex-wrap items-center gap-3 border-t pt-3 sm:col-span-2">
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY}>
          {unit ? 'Save unit' : 'Create unit'}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        {/* Sits with the commitments, not among the ten flags it speaks for.
            Until it is true the roster reports "fit not verified" rather than
            reading an unset amenity as a "no", so ticking this is what makes
            the roster judge a family's need against this cabin at all. */}
        <label className="ml-auto inline-flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={amenities.is_confirmed}
            onChange={(e) => {
              setAmenities({ ...amenities, is_confirmed: e.target.checked })
            }}
          />
          Amenities confirmed by staff
        </label>
      </div>
    </form>
  )
}
