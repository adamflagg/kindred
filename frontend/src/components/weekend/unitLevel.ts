/**
 * Which units the board draws, given each container's resolved draw level.
 *
 * A merge is a PROMOTION TO THE PARENT: the card drawn for a combined house is
 * the house's own registry row, never a synthetic one. That row's `sleeps` is
 * a DELTA over its rooms, not a whole-house total (owner ruling, kindred#2041)
 * — the beds in space belonging to no single room, e.g. a futon on a landing.
 * Whole-house capacity is `sleeps` plus every leaf beneath it; this module
 * only decides which card is drawn, so it never computes that total itself.
 *
 * Top-down, stopping at the first combined node. Two nodes on one root-to-leaf
 * path can both resolve combined — a scenario override can set one where an
 * ancestor default already holds — and taking the higher is what keeps a room
 * from being drawn twice. The admin control that prevents the confusing state
 * is a UX guard, not what makes this total.
 *
 * A second, related question also lives here: not which units get a card, but
 * which BUILDING a unit belongs to (`buildingKey`, `buildingGroups`) — the
 * grain kindred#2008 ruled (immediate parent, not walk-to-root), and what
 * #2008's placement marker (`wholeBuildingHeld`) and #2009's area header count
 * (`buildingsSpanned`) both read.
 */
import type { LodgingUnitRow } from '../../types/lodging'

function childrenByParent(units: LodgingUnitRow[]): Map<string, LodgingUnitRow[]> {
  const map = new Map<string, LodgingUnitRow[]>()
  for (const unit of units) {
    const parent = unit.parent_code ?? ''
    if (parent === '') continue
    const bucket = map.get(parent)
    if (bucket) bucket.push(unit)
    else map.set(parent, [unit])
  }
  return map
}

/** Every leaf code beneath `unit`; `[unit.code]` when it is itself a leaf. */
export function coveredCodes(unit: LodgingUnitRow, units: LodgingUnitRow[]): string[] {
  const children = childrenByParent(units)
  const out: string[] = []
  // Visited guard: the parent links carry a server-side cycle backstop
  // (guardUnitParentCycle, #1899) but a cycle already in the data must not
  // hang the board.
  const seen = new Set<string>()
  const queue = [unit]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || seen.has(next.code)) continue
    seen.add(next.code)
    const kids = children.get(next.code) ?? []
    // Leaf-ness reads the `is_container` FLAG, never child count. It is an
    // explicit "never bookable" marker the manage panel maintains — inferring
    // "this is bookable" from an empty child list infers from missing data,
    // which is exactly what the flag exists to prevent. A childless container
    // contributes no covered code: fan-down onto it yields `[]`, which routes
    // a party naming it to `offBoard` rather than a fabricated card.
    const isLeaf = next.is_container !== true
    if (isLeaf) out.push(next.code)
    else queue.push(...kids)
  }
  return out
}

/**
 * The DRAWN codes that currently represent `unit` — its own, if it is drawn,
 * else the drawn nodes beneath it, descending no further than the first one on
 * each path.
 *
 * NOT `coveredCodes`. That one walks to the raw LEAVES, past any combined node
 * in between, which is wrong for a fan-down: with `block` → `house`(combined)
 * → `r1`,`r2`, the leaves are `r1`/`r2` and NEITHER is drawn, so filtering them
 * against the drawn set yields `[]` and a party named at `block` falls off the
 * board — onto the card that exists to represent it. Stopping at the first
 * drawn node returns `['house']` instead.
 *
 * Stopping is also cheaper than filtering, and equivalent by construction:
 * `drawnUnits` descends top-down and stops at the first combined node, so no
 * descendant of a drawn node is ever itself drawn.
 *
 * Yields `[]` for a container with nothing drawable beneath it — a childless
 * one, or one whose every room is missing from the payload. That is deliberate:
 * `[]` routes the party to `offBoard` rather than inventing a card.
 */
export function representingCodes(
  unit: LodgingUnitRow,
  units: LodgingUnitRow[],
  drawn: ReadonlySet<string>
): string[] {
  const children = childrenByParent(units)
  const out: string[] = []
  // Same cycle backstop as `coveredCodes`: bad parent data must not hang the
  // board even though the server guards against writing it (#1899).
  const seen = new Set<string>()
  const queue = [unit]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || seen.has(next.code)) continue
    seen.add(next.code)
    if (drawn.has(next.code)) out.push(next.code)
    else queue.push(...(children.get(next.code) ?? []))
  }
  return out
}

/**
 * A leaf unit's "building" — the grain ruled on kindred#2008: the leaf's
 * IMMEDIATE parent, never walked further toward the root.
 *
 * Registry nesting is two levels deep, and a small number of buildings are
 * modelled as a root with two container HALVES beneath it — an upstairs and
 * a downstairs, each carrying its own `bathroom_group` — so the halves
 * behave as independently lettable units under one roof. Walking to the
 * root would merge two halves staff let separately into one "building"
 * neither of them is. The evidence for the grain is the placement history,
 * not the structural argument alone: whole-building holds resolved per
 * weekend across 2022-2025 are overwhelmingly half-level (13-17/year), not
 * root-level (see #2008).
 *
 * A leaf with no resolvable parent code is its OWN one-room building — a
 * genuinely freestanding cabin, not a fragment of anything larger. 71 of the
 * 103 leaf units in the production registry are this way (2026 measurement).
 *
 * `boardLayout.ts`'s `cardCodesFor` ALSO rolls a named code up toward an
 * ancestor, but to the nearest DRAWN one — whichever ancestor the board
 * happens to be showing a card for right now, which flips with
 * `is_combined`. That rule is deliberately NOT reused here and is rejected
 * at its own definition site: "whole building" has to be a fact about the
 * REGISTRY, not about which card the board is currently drawing, or the same
 * placement would read as holding a whole building only while its house
 * happens to be combined and stop being one the moment somebody splits it.
 */
export function buildingKey(
  unit: LodgingUnitRow,
  unitsByCode: ReadonlyMap<string, LodgingUnitRow>
): string {
  const parent = unit.parent_code ?? ''
  return parent !== '' && unitsByCode.has(parent) ? parent : unit.code
}

/**
 * Every LEAF unit, grouped into its building (`buildingKey`).
 *
 * Containers are never members of a group — a container's OWN code is what
 * becomes a group's key when a leaf names it as an immediate parent, and
 * grouping the container too would double-count it against its own
 * children.
 *
 * ONE per-registry computation, shared by both #2008's and #2009's reads —
 * `wholeBuildingHeld` below (a placement's marker) and `buildingsSpanned`
 * below (the area header's distinct count). Two copies of "what building is
 * this" is exactly how the two numbers would start disagreeing.
 */
export function buildingGroups(units: LodgingUnitRow[]): Map<string, string[]> {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))
  const groups = new Map<string, string[]>()
  for (const unit of units) {
    if (unit.is_container === true) continue
    const key = buildingKey(unit, unitsByCode)
    const bucket = groups.get(key)
    if (bucket) bucket.push(unit.code)
    else groups.set(key, [unit.code])
  }
  return groups
}

/**
 * How many distinct buildings a set of drawn units span — #2009's area
 * header count.
 *
 * Reads the RAW LEAVES beneath each drawn unit (`coveredCodes`), never the
 * drawn unit's own code: a container combined at the ROOT rather than at a
 * half (rare — the placement history says whole-building holds are nearly
 * always half-level) still structurally spans however many `buildingKey`
 * groups its leaves fall into. A card drawn ABOVE the building grain must
 * not be counted as one building just because the board is drawing it as
 * one card — `slots.length` already counts CARDS; this counts something
 * different on purpose.
 */
export function buildingsSpanned(drawnUnits: LodgingUnitRow[], units: LodgingUnitRow[]): number {
  const groups = buildingGroups(units)
  const leafBuilding = new Map<string, string>()
  for (const [key, leaves] of groups) {
    for (const leaf of leaves) leafBuilding.set(leaf, key)
  }
  const touched = new Set<string>()
  for (const unit of drawnUnits) {
    for (const leaf of coveredCodes(unit, units)) {
      const key = leafBuilding.get(leaf)
      if (key !== undefined) touched.add(key)
    }
  }
  return touched.size
}

/**
 * Whether a set of occupied LEAF codes covers an entire building —
 * #2008's placement marker.
 *
 * Takes the already-expanded leaf set rather than a party or a named code,
 * so this module stays pure over `LodgingUnitRow[]` — the party-shaped
 * wrapper (`occupiedLeafCodes` in `boardLayout.ts`) calls this, not the
 * reverse, which is what keeps the two files from cycling.
 *
 * A group of exactly one is a standalone room, not a building with siblings
 * to hold ALL of — see `buildingKey`'s doc. Requiring `length > 1` is what
 * keeps this signal to the genuine whole-building holds in the placement
 * history rather than firing on most single-room placements: 71 of the 103
 * production leaf units have no registry parent at all, so without this
 * exclusion every one of those ordinary single-room placements would
 * trivially "cover" its own one-room group.
 */
export function wholeBuildingHeld(
  occupiedLeaves: ReadonlySet<string>,
  units: LodgingUnitRow[]
): boolean {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))
  const groups = buildingGroups(units)
  const touchedKeys = new Set<string>()
  for (const leaf of occupiedLeaves) {
    const unit = unitsByCode.get(leaf)
    if (unit !== undefined) touchedKeys.add(buildingKey(unit, unitsByCode))
  }
  for (const key of touchedKeys) {
    const group = groups.get(key) ?? []
    if (group.length > 1 && group.every((code) => occupiedLeaves.has(code))) return true
  }
  return false
}

/** The units that get a card, at the level each tree resolves to. */
export function drawnUnits(units: LodgingUnitRow[]): LodgingUnitRow[] {
  const children = childrenByParent(units)
  const byCode = new Map(units.map((unit) => [unit.code, unit]))
  const roots = units.filter((unit) => {
    const parent = unit.parent_code ?? ''
    return parent === '' || !byCode.has(parent)
  })

  const drawn: LodgingUnitRow[] = []
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || seen.has(next.code)) continue
    seen.add(next.code)
    const kids = children.get(next.code) ?? []
    // Leaf-ness reads the `is_container` FLAG, never child count — see the
    // matching comment in `coveredCodes`. A leaf always draws. A container
    // draws only when combined; otherwise it is pure grouping and we descend
    // past it, even if it currently has no children in the array. A
    // momentarily childless container (created before its rooms are
    // reparented under it) is expected workflow, not a data error to route
    // around — owner-confirmed: it stays cardless until it is parented.
    const isLeaf = next.is_container !== true
    if (isLeaf || next.is_combined === true) drawn.push(next)
    else queue.push(...kids)
  }
  return drawn
}
