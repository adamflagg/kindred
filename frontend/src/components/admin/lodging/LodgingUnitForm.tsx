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
 *    other half of this paragraph, and a stored coordinate survives a save
 *    because those keys are UNCONDITIONALLY ABSENT from the payload — not
 *    because a guard omits them when blank.
 *
 *    THAT IS STILL TRUE now the map editor is back (kindred#2013), and it is
 *    true BY CONSTRUCTION rather than by a guard: `UnitMapPositionField`
 *    writes the coordinate itself on pointer-up, the way
 *    `LodgingAreasDrawer` writes an area's centroid on blur. It never feeds
 *    this payload, so there is no blank field here that could land as a 0
 *    and turn "unpositioned" into "positioned at the top-left". Anyone
 *    moving the coordinate INTO this payload has to add that guard first.
 *
 * 3. The season is captured WHEN THE EDITOR OPENS, not read live. Units are
 *    year-scoped since 1500000141 and this form always submits `year`, so a
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
  ShareabilityStoredValue,
} from '../../../types/lodging'
import {
  resolveShareGroupId,
  sharePeerCandidates,
  sharePeerWrites,
  storedPeerIds,
} from './bathroomShare'
import { amenitiesOf } from './unitAmenities'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from './lodgingStyles'
import { parseSleeps } from './sleepsValue'
import { slugify } from './unitCode'
import { combinedAncestor, directChildren } from './unitTree'
import { UnitAmenityFieldset } from './UnitAmenityFieldset'
import { UnitCapacityFields } from './UnitCapacityFields'
import { UnitIdentityFields } from './UnitIdentityFields'
import { UnitMapPositionField } from './UnitMapPositionField'

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
   * 1500000141, and this form always writes it — on create because the schema
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
  /**
   * A map coordinate landed (kindred#2013). SEPARATE from `onSaved`, which
   * closes the editor: the pin saves on pointer-up and the staffer is still
   * working, so the host may only refresh the cached registry here — it must
   * not dismiss the form out from under them.
   */
  onPositionSaved?: (() => void) | undefined
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
  onPositionSaved,
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
  // Its own state, NOT part of `amenities` (kindred#2026). The amenity bag is
  // governed by the single `is_confirmed` checkbox; shareability is a policy
  // classification the read path trusts the moment it is stored, so it sits
  // with the other policy classifications below rather than with the flags.
  // '' is UNCLASSIFIED and is where a new unit starts — defaulting a fresh
  // unit to 'single_party' would look tidier and would be a claim nobody made.
  const [shareability, setShareability] = useState<ShareabilityStoredValue>(
    unit?.shareability ?? ''
  )
  const [isActive, setIsActive] = useState(unit ? unit.is_active : true)
  const [isContainer, setIsContainer] = useState(unit?.is_container ?? false)
  const [combined, setCombined] = useState(unit?.default_combined ?? false)
  const [notes, setNotes] = useState(unit?.notes ?? '')
  const [isSaving, setIsSaving] = useState(false)
  // A CREATE THAT LANDED IS NOT RETRYABLE AS A CREATE. The peer writes below
  // are N+1 and non-atomic, so a create can succeed and leave the bathroom
  // group half written — and this form deliberately stays open on that,
  // because the retry is the only way to finish it. But `code` is UNIQUE per
  // (code, year), so a second submit would be rejected by PocketBase for
  // colliding with the row this same form just wrote, and the staffer would
  // be stranded with a peer pointing at a group nothing else joined. Holding
  // the new record's id turns every submit after the first into an UPDATE of
  // it, which is idempotent and converges.
  const [createdId, setCreatedId] = useState<string | null>(null)
  // Captured, not read live — see the `year` prop's doc comment above.
  const [openedYear] = useState(year)
  // Untying this unit's children from it would leave them parented by a
  // non-container — the exact state verify-lodging-seed.sh calls a failure.
  const children = unit ? directChildren(unit.id, units) : []
  // Live off the SELECTED parent, not the stored one, so re-parenting a unit
  // in this same form updates the combined control's disable state
  // immediately rather than waiting for a reload.
  const blockingAncestor =
    identity.parent_unit === '' ? undefined : combinedAncestor(identity.parent_unit, units)
  // Derived from the units already in hand, so no extra fetch and no second
  // source of truth about which groups exist.
  const bathroomGroups = [
    ...new Set(units.map((u) => u.bathroom_group).filter((g) => g !== '')),
  ].sort((a, b) => a.localeCompare(b))
  // The bathroom share, named in ROOMS (kindred#2023). `bathroomPeerIds` is
  // the on-screen membership; `amenities.bathroom_group` stays the stored id
  // and is recomputed only when a chip is added or removed, never at mount —
  // an untouched group of one is warned about, not silently rewritten.
  const storedBathroomGroup = unit?.bathroom_group ?? ''
  const [bathroomPeerIds, setBathroomPeerIds] = useState(() => storedPeerIds(unit, units))
  const unitsById = new Map(units.map((u) => [u.id, u]))
  /**
   * The building whose pin this unit draws on, or `undefined` when the unit is
   * itself the pin site — the mirror of `mapModel`'s `pinFor`, in ids rather
   * than codes because this form's relation field holds `parent_unit`.
   *
   * THE ROOT, walked all the way up (kindred#2440 question 4, re-ruled by the
   * owner 2026-08-30). `is_container` deliberately plays no part: a half of a
   * house draws on the house, so what decides this is only whether the unit
   * has a parent at all. Under the superseded immediate-parent grain a
   * container was always its own pin site, which is how the Health Center came
   * to draw three marks on one roof.
   *
   * A parent the payload does not carry stops the walk rather than yielding
   * nothing, matching `mapBuildingKey`: an unresolvable relation must not take
   * the control away with nothing to point at.
   */
  const pinBuilding = (() => {
    let current = unitsById.get(identity.parent_unit)
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      const next = unitsById.get(current.parent_unit)
      if (next === undefined) break
      current = next
    }
    return current
  })()
  const shareParent = unitsById.get(identity.parent_unit)
  const sharePeers = bathroomPeerIds
    .map((id) => unitsById.get(id))
    .filter((peer): peer is LodgingUnitRecord => peer !== undefined)
  const shareCandidates = sharePeerCandidates(
    unit?.id,
    identity.parent_unit,
    bathroomPeerIds,
    units,
    storedBathroomGroup
  )
  const setBathroomPeers = (next: string[]) => {
    setBathroomPeerIds(next)
    setAmenities((current) => ({
      ...current,
      bathroom_group: resolveShareGroupId(storedBathroomGroup, next, units, shareParent),
    }))
  }

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
    // WHETHER THE ROW EXISTS, not which button was pressed. An editor opened
    // on a stored unit has one from the start; a create form acquires one the
    // moment `createLodgingUnit` returns, and every rule below that says
    // "on edit" turns on this and not on `unit`.
    const existingId = unit?.id ?? createdId ?? undefined
    const payload: LodgingUnitInput = {
      area: identity.area,
      name: identity.name,
      code,
      year: openedYear,
      parent_unit: identity.parent_unit,
      // Never omitted — see the header comment.
      is_active: isActive,
      inventory_class: inventoryClass,
      // Always sent, create and edit alike, for the same reason `is_active`
      // and `inventory_class` are: '' is a real value here (unclassified), so
      // omitting the key on an EDIT would make clearing the field a silent
      // no-op the staffer believes worked.
      shareability,
      is_container: isContainer,
      default_combined: combined,
      notes,
      beds: capacity.beds,
      ...amenities,
      // Create omits it so PocketBase writes its own 0. Edit sends an explicit
      // 0, because 0 IS the stored representation of UNKNOWN — omitting the
      // key would leave the previous number in place and make clearing the
      // field a silent no-op the staffer believes worked. Keyed on
      // `existingId`, so the second submit after a create that landed follows
      // the EDIT rule, which is what it now is.
      ...(parsedSleeps === null
        ? existingId !== undefined
          ? { sleeps: 0 }
          : {}
        : { sleeps: parsedSleeps }),
    }
    // Sharing a bathroom is SYMMETRIC and the column is one string per unit,
    // so what the staffer asserted here has to land on the peers' records too
    // — removals included. Computed BEFORE the unit's own write, off the units
    // the form was given. `existingId` excludes the edited row from the removal
    // sweep, which a retry after a landed create needs as much as an edit does.
    //
    // GATED ON THE CHIPS, not on the column. Symmetric peer writes are what
    // the chips MEAN, and a parentless unit has no chips — it keeps the raw-id
    // input (see UnitAmenityFieldset). Driving peer writes off that field would
    // rewrite records nothing on screen ever named, and the partial-failure
    // toast below would report rooms the staffer has no idea they touched.
    // Zero parentless units carry a group in production, so this costs
    // nothing today and keeps the invisible destructive write impossible.
    const peerWrites =
      shareParent === undefined
        ? []
        : sharePeerWrites(
            existingId,
            storedBathroomGroup,
            bathroomPeerIds,
            amenities.bathroom_group,
            units
          )
    try {
      if (existingId !== undefined) {
        await updateLodgingUnit(existingId, payload)
      } else {
        const created = await createLodgingUnit(payload)
        setCreatedId(created.id)
      }
    } catch (error) {
      // Nothing else is attempted. Peers pointing at a group the unit never
      // joined is the one partial state with no honest way to describe it.
      toast.error(saveErrorMessage(error))
      setIsSaving(false)
      return
    }

    // N+1 SEQUENTIAL, NON-ATOMIC WRITES. That is the accepted cost of saying
    // this in rooms rather than in ids, and the loop is deliberate rather than
    // an oversight — but unlike `reorderLodgingAreas`, which stops at the
    // first failure because a PREFIX of a ranking is meaningful, group
    // membership is a SET: a prefix is worth no more than any other subset, so
    // every write is attempted and the exact partition is reported by name.
    // That is `confirmLodgingUnits`' discipline, one step further — names, not
    // a count, because the staffer has to know WHICH room to check.
    //
    // A retry is safe and converges: every write sets an absolute value, so
    // replaying the whole set over a partially-applied one lands in the same
    // place. The form keeps its (now slightly stale) `units`, which only means
    // the successful writes are attempted again.
    const wrote: string[] = []
    const failed: string[] = []
    for (const peer of peerWrites) {
      try {
        await updateLodgingUnit(peer.id, { bathroom_group: peer.bathroom_group })
        wrote.push(peer.name)
      } catch {
        failed.push(peer.name)
      }
    }

    if (failed.length > 0) {
      // NOT a completed state: no success toast, and `onSaved` is not called,
      // so the editor stays open on a half-written group instead of closing
      // over it. The precedent this deliberately does NOT follow is
      // WeekendFriendGroups, which reports a partial write as a success.
      toast.error(
        `This room saved, but the shared bathroom is only half recorded. Updated: ${
          wrote.length > 0 ? wrote.join(', ') : 'no other rooms'
        }. Not updated: ${failed.join(', ')}. Submit again to finish.`
      )
      setIsSaving(false)
      return
    }

    toast.success(unit ? 'Unit saved' : 'Unit created')
    onSaved()
    setIsSaving(false)
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
        onInventoryClassChange={setInventoryClass}
      />

      {/* is_confirmed and is_container are read LIVE rather than off `unit`:
          both silence the capacity flag, and a staffer who has just ticked
          either has already made the ruling the flag would be asking for. */}
      <UnitCapacityFields
        value={capacity}
        onChange={setCapacity}
        isConfirmed={amenities.is_confirmed}
        isContainer={isContainer}
        unit={unit}
        units={units}
      />

      <UnitAmenityFieldset
        value={amenities}
        onChange={setAmenities}
        bathroomGroups={bathroomGroups}
        shareParent={shareParent}
        sharePeers={sharePeers}
        shareCandidates={shareCandidates}
        onAddSharePeer={(id) => {
          setBathroomPeers([...bathroomPeerIds, id])
        }}
        onRemoveSharePeer={(id) => {
          setBathroomPeers(bathroomPeerIds.filter((peer) => peer !== id))
        }}
        shareability={shareability}
        onShareabilityChange={setShareability}
        inventoryClass={inventoryClass}
        isContainer={isContainer}
      />

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
              const next = e.target.checked
              setIsContainer(next)
              // The combined control below renders only while isContainer is
              // true, so unticking this hides it — but hiding is not
              // clearing. Without this, the payload can still save
              // default_combined: true beside is_container: false, the
              // exact contradiction verify-slot-merge-seed.sh's `leaked`
              // check refuses to see in the registry.
              if (!next) setCombined(false)
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
        {/* Registry default for the whole-let container merge (spec task 8).
            Rendered on containers only — a leaf has nothing to stop
            descending past. Disabled once an ancestor already carries the
            flag: at most one node per root-to-leaf path may hold it
            meaningfully, since combined means "draw the card here and stop
            descending" and an ancestor already owns the card.

            This is a UX guard, not a correctness requirement — `drawnUnits`
            (frontend/src/components/weekend/unitLevel.ts) resolves top-down
            and takes the highest combined node on a path, so the board
            cannot be made ambiguous even by a direct database write that
            skipped this picker. See `combinedAncestor` in ./unitTree for the
            ancestor walk. */}
        {isContainer && (
          <div className="pt-1">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={combined}
                disabled={blockingAncestor !== undefined}
                onChange={(e) => {
                  setCombined(e.target.checked)
                }}
              />
              Assign it as a whole building — one slot, not one per bedroom.
            </label>
            {blockingAncestor && (
              <p className="text-muted-foreground pl-6 text-xs">
                Already combined by “{blockingAncestor.name}” — only one card per branch.
              </p>
            )}
          </div>
        )}
      </div>

      {/* EDIT ONLY, and only for the unit that CARRIES the pin. A unit being
          created has no id to write a coordinate to.

          Which unit carries it is kindred#2440's ruling (2026-08-21): the map
          is a view of BUILDINGS, so a unit draws at its building's point and
          its own coordinate is never read. The building is the ROOT (question
          4, re-ruled 2026-08-30), so the pin belongs to the outermost
          container of the tree — and this gate USED TO SAY THE OPPOSITE, in
          two ways. It withheld the pin from every container, on the superseded
          model that a building carried its rooms' positions through its
          children; left alone that made the pin uneditable for every building
          with rooms, while still offering each of those rooms a control that
          saved a value nothing reads.

          Read LIVE off the SELECTED parent, like the capacity flag above: a
          staffer who has just re-parented a unit has already made the ruling.
          `isContainer` is deliberately NOT consulted — a half of a house draws
          on the house, container or not. The pin writes on pointer-up and is
          NOT part of this form's payload — see UnitMapPositionField's
          header. */}
      {unit && pinBuilding === undefined && (
        <UnitMapPositionField unit={unit} onPositionSaved={onPositionSaved} />
      )}

      {/* SAYS WHERE THE CONTROL WENT. A capability that disappears without
          naming its new home is a capability loss however sound the data
          model is, so an inheriting room points at the building it draws on
          rather than simply losing the field. */}
      {unit && pinBuilding !== undefined && (
        <div className="sm:col-span-2">
          <span className={LABEL}>Map position</span>
          <p className="text-muted-foreground text-sm">
            Drawn at {pinBuilding.name}&rsquo;s pin, with the rest of the building. Position{' '}
            {pinBuilding.name} to move it.
          </p>
        </div>
      )}

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
