/**
 * Create/edit one lodging unit.
 *
 * THREE THINGS THIS FORM EXISTS TO GET RIGHT:
 *
 * 1. is_active and allocation_default are ALWAYS submitted. PocketBase has
 *    no per-field default for bool or select, and `required: true` on a bool
 *    means "must be true", so neither can be required in the schema. A create
 *    that omits them yields `is_active = false, allocation_default = ''`:
 *    a unit no list query returns, which also matches neither branch of the
 *    family-availability rules.
 *
 * 2. `sleeps` is three-state. Blank means UNKNOWN, and PocketBase stores an
 *    unset number as 0 (columns are NUMERIC DEFAULT 0 NOT NULL, never NULL).
 *    So a stored 0 renders as a BLANK field, not as "0", and a blank field
 *    submits no sleeps key at all.
 *
 * 3. The bathroom options are the ones PocketBase STORES, not the ones the
 *    read API emits. The API renders an empty column as the token `unknown`;
 *    that token is not in the select's option list, so writing it back fails
 *    validation. Unrecorded is `''`.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingUnit, updateLodgingUnit } from '../../../services/lodgingCrud'
import type {
  AllocationDefaultValue,
  BathroomStoredValue,
  LodgingAreaRecord,
  LodgingUnitInput,
  LodgingUnitRecord,
} from '../../../types/lodging'

export interface LodgingUnitFormProps {
  areas: LodgingAreaRecord[]
  /** Absent = create. `| undefined` is explicit for `exactOptionalPropertyTypes`. */
  unit?: LodgingUnitRecord | undefined
  onSaved: () => void
  onCancel: () => void
}

const FIELD = 'border-border bg-background w-full rounded-md border px-2 py-1 text-sm'
const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

export function LodgingUnitForm({ areas, unit, onSaved, onCancel }: LodgingUnitFormProps) {
  const [name, setName] = useState(unit?.name ?? '')
  const [code, setCode] = useState(unit?.code ?? '')
  const [area, setArea] = useState(unit?.area ?? areas[0]?.id ?? '')
  // A stored 0 means UNKNOWN, so it maps to an empty input.
  const [sleeps, setSleeps] = useState(unit && unit.sleeps > 0 ? String(unit.sleeps) : '')
  const [bathroom, setBathroom] = useState<BathroomStoredValue>(unit?.bathroom ?? '')
  const [bathroomGroup, setBathroomGroup] = useState(unit?.bathroom_group ?? '')
  const [allocation, setAllocation] = useState<AllocationDefaultValue>(
    unit?.allocation_default === 'staff_default' ? 'staff_default' : 'family_pool'
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [isConfirmed, setIsConfirmed] = useState(unit?.is_confirmed ?? false)
  const [hasPower, setHasPower] = useState(unit?.has_power ?? false)
  const [isAccessible, setIsAccessible] = useState(unit?.is_accessible ?? false)
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    const parsedSleeps = Number.parseInt(sleeps, 10)
    const payload: LodgingUnitInput = {
      area,
      name,
      code,
      // Never omitted — see the header comment.
      is_active: isActive,
      allocation_default: allocation,
      bathroom,
      bathroom_group: bathroomGroup,
      has_power: hasPower,
      is_accessible: isAccessible,
      is_container: isContainer,
      is_confirmed: isConfirmed,
      ...(Number.isNaN(parsedSleeps) ? {} : { sleeps: parsedSleeps }),
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
      <label className="text-sm">
        <span className={LABEL}>Name</span>
        <input
          className={FIELD}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
          }}
          required
        />
      </label>

      <label className="text-sm">
        <span className={LABEL}>Code</span>
        <input
          className={FIELD}
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
          }}
          required
        />
      </label>

      <label className="text-sm">
        <span className={LABEL}>Area</span>
        <select
          className={FIELD}
          value={area}
          onChange={(e) => {
            setArea(e.target.value)
          }}
        >
          {areas.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className={LABEL}>Sleeps</span>
        <input
          className={FIELD}
          type="number"
          min={1}
          value={sleeps}
          placeholder="Unknown"
          onChange={(e) => {
            setSleeps(e.target.value)
          }}
        />
      </label>

      <label className="text-sm">
        <span className={LABEL}>Bathroom</span>
        {/* These are the STORED values. The API's `unknown` token is not one
            of them — writing it back would fail the select's validation. */}
        <select
          className={FIELD}
          value={bathroom}
          onChange={(e) => {
            setBathroom(e.target.value as BathroomStoredValue)
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
          value={bathroomGroup}
          placeholder="Units sharing one bathroom carry the same id"
          onChange={(e) => {
            setBathroomGroup(e.target.value)
          }}
        />
      </label>

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
          <option value="family_pool">Family pool</option>
          <option value="staff_default">Staff by default</option>
        </select>
      </label>

      <fieldset className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
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
          Building (never bookable or counted)
        </label>
        {/* Confirming is what lets the roster judge a housing need against this
            cabin at all. While it is false, the roster reports "fit not
            verified" rather than treating an unset amenity as a "no". */}
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isConfirmed}
            onChange={(e) => {
              setIsConfirmed(e.target.checked)
            }}
          />
          Amenities confirmed by staff
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasPower}
            onChange={(e) => {
              setHasPower(e.target.checked)
            }}
          />
          Has power
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isAccessible}
            onChange={(e) => {
              setIsAccessible(e.target.checked)
            }}
          />
          Accessible
        </label>
      </fieldset>

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={isSaving}
          className="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {unit ? 'Save unit' : 'Create unit'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
