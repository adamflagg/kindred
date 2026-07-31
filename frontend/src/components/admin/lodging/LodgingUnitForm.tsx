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
import { normaliseBeds, suggestedSleeps, type BedInventory } from '../../../types/beds'
import type {
  AllocationDefaultValue,
  BathroomStoredValue,
  LodgingAreaRecord,
  LodgingUnitInput,
  LodgingUnitRecord,
} from '../../../types/lodging'
import { BedInventoryEditor } from './BedInventoryEditor'

export interface LodgingUnitFormProps {
  areas: LodgingAreaRecord[]
  /** Every unit, for the parent picker. A unit may not be its own parent. */
  units: LodgingUnitRecord[]
  /** Absent = create. `| undefined` is explicit for `exactOptionalPropertyTypes`. */
  unit?: LodgingUnitRecord | undefined
  onSaved: () => void
  onCancel: () => void
}

const FIELD = 'border-border bg-background w-full rounded-md border px-2 py-1 text-sm'
const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

/**
 * Derive a stable slug from the display name.
 *
 * `code` is a real join key — `bathroom_group` membership matches on codes and
 * the roster keys on `unit_code` — so it is generated once on create and only
 * editable behind a disclosure. Renaming an existing code is not safe.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function LodgingUnitForm({ areas, units, unit, onSaved, onCancel }: LodgingUnitFormProps) {
  const [name, setName] = useState(unit?.name ?? '')
  const [code, setCode] = useState(unit?.code ?? '')
  const [area, setArea] = useState(unit?.area ?? areas[0]?.id ?? '')
  // A stored 0 means UNKNOWN, so it maps to an empty input.
  const [sleeps, setSleeps] = useState(unit && unit.sleeps > 0 ? String(unit.sleeps) : '')
  const [beds, setBeds] = useState<BedInventory>(normaliseBeds(unit?.beds))
  const [bathroom, setBathroom] = useState<BathroomStoredValue>(unit?.bathroom ?? '')
  const [bathroomGroup, setBathroomGroup] = useState(unit?.bathroom_group ?? '')
  const [allocation, setAllocation] = useState<AllocationDefaultValue>(
    unit?.allocation_default === 'staff_default' ? 'staff_default' : 'family_pool'
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [isConfirmed, setIsConfirmed] = useState(unit?.is_confirmed ?? false)
  const [hasPower, setHasPower] = useState(unit?.has_power ?? false)
  const [hasAc, setHasAc] = useState(unit?.has_ac ?? false)
  const [hasFridge, setHasFridge] = useState(unit?.has_fridge ?? false)
  const [nearBathhouse, setNearBathhouse] = useState(unit?.near_bathhouse ?? false)
  const [isAccessible, setIsAccessible] = useState(unit?.is_accessible ?? false)
  const [parentUnit, setParentUnit] = useState(unit?.parent_unit ?? '')
  const [mapX, setMapX] = useState(unit ? String(unit.map_x) : '')
  const [mapY, setMapY] = useState(unit ? String(unit.map_y) : '')
  const [notes, setNotes] = useState(unit?.notes ?? '')
  const [showCode, setShowCode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    const parsedSleeps = Number.parseInt(sleeps, 10)
    const effectiveCode = code.trim() === '' ? slugify(name) : code.trim()
    const parsedMapX = Number.parseFloat(mapX)
    const parsedMapY = Number.parseFloat(mapY)
    const payload: LodgingUnitInput = {
      area,
      name,
      code: effectiveCode,
      // Never omitted — see the header comment.
      is_active: isActive,
      allocation_default: allocation,
      bathroom,
      bathroom_group: bathroomGroup,
      has_power: hasPower,
      has_ac: hasAc,
      has_fridge: hasFridge,
      near_bathhouse: nearBathhouse,
      is_accessible: isAccessible,
      is_container: isContainer,
      is_confirmed: isConfirmed,
      parent_unit: parentUnit,
      notes,
      beds,
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

      {showCode || unit ? (
        <label className="text-sm">
          <span className={LABEL}>Code</span>
          <input
            className={FIELD}
            value={code}
            placeholder={slugify(name)}
            onChange={(e) => {
              setCode(e.target.value)
            }}
          />
        </label>
      ) : (
        <div className="flex items-end text-sm">
          <button
            type="button"
            onClick={() => {
              setShowCode(true)
            }}
            className="text-muted-foreground text-xs font-medium hover:underline"
          >
            Code will be “{slugify(name) || '…'}” — set it manually
          </button>
        </div>
      )}

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
        <span className={LABEL}>Parent unit</span>
        {/* The subdivide/combine hierarchy (spec §3.2). A merge will later be
            legal only when its members are the complete child set of one
            container, so this is the structure that makes partial merges —
            two bedrooms of a four-room building — expressible at all. */}
        <select
          className={FIELD}
          value={parentUnit}
          onChange={(e) => {
            setParentUnit(e.target.value)
          }}
        >
          <option value="">No parent</option>
          {units
            .filter((candidate) => candidate.id !== unit?.id)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
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

      <div className="text-sm sm:col-span-2">
        <span className={LABEL}>Beds</span>
        <BedInventoryEditor beds={beds} onChange={setBeds} />
        {beds.length > 0 && (
          <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
            <span>Suggested: sleeps {suggestedSleeps(beds)}</span>
            <button
              type="button"
              onClick={() => {
                setSleeps(String(suggestedSleeps(beds)))
              }}
              className="text-primary font-medium hover:underline"
            >
              Use suggested
            </button>
          </div>
        )}
      </div>

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
          <option value="family_pool">Available to guests</option>
          <option value="staff_default">Held for staff</option>
        </select>
      </label>

      <div className="text-sm sm:col-span-2">
        <span className={LABEL}>Structure</span>
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
            checked={hasAc}
            onChange={(e) => {
              setHasAc(e.target.checked)
            }}
          />
          Has A/C
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasFridge}
            onChange={(e) => {
              setHasFridge(e.target.checked)
            }}
          />
          Has fridge
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={nearBathhouse}
            onChange={(e) => {
              setNearBathhouse(e.target.checked)
            }}
          />
          Near bathhouse
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

      <label className="text-sm">
        <span className={LABEL}>Map X</span>
        <input
          className={FIELD}
          type="number"
          step="0.001"
          min={0}
          max={1}
          value={mapX}
          placeholder="0–1"
          onChange={(e) => {
            setMapX(e.target.value)
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
          value={mapY}
          placeholder="0–1"
          onChange={(e) => {
            setMapY(e.target.value)
          }}
        />
      </label>

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
