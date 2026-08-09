/**
 * Parent-unit relationships: who may be whose parent, and who currently is.
 *
 * The parent picker (`UnitIdentityFields`) has to reject two things the API
 * does not stop: setting a unit's parent to one of its own descendants — a
 * cycle `descendantIds`' own walk below and the Go-side `HasParentCycle`
 * would otherwise have to guard against every time they run — and a
 * non-container parent, which `scripts/dev/verify-lodging-seed.sh` treats as
 * a seed failure. Nothing else walks parent links DOWNWARD: `descendantIds`
 * below, `flattenUnitTree` below (the lodging table's tree-order render,
 * #2082), and the Go-side `HasParentCycle` are the only three, and all carry
 * visited guards. `combinedAncestor` below walks the other direction, up
 * toward the root, and carries its own visited guard for the same reason —
 * a data-only cycle predates `guardUnitParentCycle` (#1899) and that hook
 * cannot un-write one already sitting in the database. This filters both
 * things the picker rejects before either ever reaches a write.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'
import { sortUnits, type UnitSort } from './unitSort'

/** Every id descending from `unitId` via `parent_unit` — its children, grandchildren, and so on. */
export function descendantIds(unitId: string, units: LodgingUnitRecord[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const unit of units) {
    if (unit.parent_unit === '') continue
    const siblings = childrenOf.get(unit.parent_unit)
    if (siblings) siblings.push(unit.id)
    else childrenOf.set(unit.parent_unit, [unit.id])
  }

  const result = new Set<string>()
  const queue = [...(childrenOf.get(unitId) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || result.has(next)) continue
    result.add(next)
    queue.push(...(childrenOf.get(next) ?? []))
  }
  return result
}

/** Units that currently name `unitId` as their `parent_unit` — one level only. */
export function directChildren(unitId: string, units: LodgingUnitRecord[]): LodgingUnitRecord[] {
  return units.filter((unit) => unit.parent_unit === unitId)
}

/**
 * Walking up from `parentId` via `parent_unit`, the nearest unit that already
 * has `default_combined` set — or `undefined` if none does.
 *
 * `default_combined` means "draw the card HERE and stop descending", so at
 * most one node per root-to-leaf path may hold it meaningfully: a combined
 * ancestor already owns the card, and a descendant setting it too changes
 * nothing. This is what the admin control (`UnitIdentityFields`) disables
 * against.
 *
 * THIS IS A UX GUARD, NOT WHAT MAKES THE BOARD CORRECT. `drawnUnits`
 * (frontend/src/components/weekend/unitLevel.ts) resolves top-down and takes
 * the highest combined node on a path regardless of what a lower node
 * claims, so a direct database write that skipped this picker could not make
 * the board draw a room twice — it would just leave a redundant, inert flag
 * on a descendant.
 *
 * Visited guard to match this file's other walk (`descendantIds`): a cycle
 * already in the data must not hang the admin form. There is a server-side
 * backstop against writing a NEW cycle (`guardUnitParentCycle`, #1899), but
 * this does not rely on it.
 */
export function combinedAncestor(
  parentId: string,
  units: LodgingUnitRecord[]
): LodgingUnitRecord | undefined {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const seen = new Set<string>()
  let currentId = parentId
  while (currentId !== '' && !seen.has(currentId)) {
    seen.add(currentId)
    const current = byId.get(currentId)
    if (!current) return undefined
    if (current.default_combined) return current
    currentId = current.parent_unit
  }
  return undefined
}

/**
 * Valid parent candidates for `unitId`: containers only, excluding the unit
 * itself and anything descending from it. On create (`unitId` undefined)
 * there is no self or descendant yet, so every container is offered.
 *
 * `areaId` narrows the list to one area. A room's building stands on the same
 * patch of ground as the room, and every parent/child pair on site is
 * same-area, so an out-of-area container is never the answer — it is only a
 * chance to parent a cabin to a building across camp by mis-clicking. Omit it
 * and nothing is narrowed.
 *
 * `inventoryClass` narrows it again, and DELIBERATELY IN ONE DIRECTION ONLY.
 * A guest room is never a room inside staff housing — no unit on site is — and
 * because both buildings stand in the same area, the area filter alone still
 * offers the wrong one. The converse is not true and must not be enforced: one
 * building on site is a guest building holding two guest rooms and one staff
 * room, so hiding guest buildings from staff units would deny a new staff room
 * there its real parent. Buildings are mixed; staff housing is not.
 *
 * Both narrowings spare the CURRENT parent whatever it is — the caller's
 * `currentParentId`, not something this function looks up. Filtering a
 * current parent out of its own picker would leave the select with no
 * matching option, so it would fall to the first entry and the next save
 * would silently reparent a unit the staffer only meant to rename — the
 * exact accident these filters exist to prevent, arriving through them.
 *
 * `currentParentId` MUST be the LIVE, not-yet-saved selection — the same
 * value `LodgingUnitForm`'s `blockingAncestor` reads off `identity.parent_unit`
 * — not a lookup of the STORED record (`units.find((u) => u.id ===
 * unitId)?.parent_unit`, #2065). A staffer can pick a parent, then change
 * Area or Allocation before saving; if the narrowing looks up the stored
 * value it still finds the OLD parent (or none, on a unit being created),
 * so the just-picked selection silently drops out of the options while
 * remaining the form's value. A `<select>` whose value isn't among its
 * options renders blank while the stale value rides through to the next
 * save. On mount the caller's live value equals the stored one, so the
 * grandfather-clause behavior below is unchanged for that case.
 */
export function parentCandidates(
  unitId: string | undefined,
  units: LodgingUnitRecord[],
  currentParentId: string,
  areaId?: string,
  inventoryClass?: string
): LodgingUnitRecord[] {
  const excluded = unitId === undefined ? new Set<string>() : descendantIds(unitId, units)
  return units.filter((candidate) => {
    if (!candidate.is_container || candidate.id === unitId || excluded.has(candidate.id)) {
      return false
    }
    if (candidate.id === currentParentId) return true
    if (areaId !== undefined && candidate.area !== areaId) return false
    // One direction only — see the header. Guest rooms are kept out of staff
    // housing; staff rooms are NOT kept out of guest buildings, because more
    // than one building on site is a guest building with a staff room in it.
    if (inventoryClass === 'family_pool' && candidate.inventory_class === 'staff_default') {
      return false
    }
    return true
  })
}

/** One row of a tree-ordered unit table: the unit, and how deep its `parent_unit` chain put it. */
export interface UnitTreeRow {
  unit: LodgingUnitRecord
  depth: number
}

/**
 * `units` — one area group's worth — in TREE order: a parent's row
 * immediately followed by its own subtree, at whatever depth the
 * `parent_unit` chain actually puts it. NEVER one level — three containers
 * on site hold container children too (#2082), so `parent_unit !== ''` alone
 * would misplace those rows.
 *
 * `sort` orders each SIBLING SET only — a building's own rooms among
 * themselves, and the group's roots among themselves — never the group as
 * one flat ranking. That is the load-bearing decision behind this function:
 * "indent-plus-unchanged-flat-sort" (sorting the whole group, then indenting
 * whatever came out) is the one option #2082 rules out shipping, because it
 * is the only one that can display a FALSE PARENT — a child whose own sort
 * key outranks another root's row would read as indented under that root.
 * Tree-order-always means a root and its whole subtree move together
 * regardless of which column is active.
 *
 * A unit whose `parent_unit` does not resolve to another unit IN THIS GROUP
 * — unset, or naming a unit outside it — renders as its own root at depth 0
 * rather than being dropped. That is what keeps `groupUnitsByArea`'s
 * trailing `__unassigned__` bucket (`unitSort.ts`) safe to walk: those units
 * have no guaranteed parent in the same bucket, so this never crashes on a
 * lookup that can't find its target.
 *
 * Visited guard to match this file's other walks. Unlike `descendantIds` and
 * `combinedAncestor`, which start from one known id, this one starts from
 * every ROOT in the group — so a pure cycle with no unit reachable from an
 * actual root (every member's `parent_unit` also resolves inside the cycle)
 * would never be found by the top-down pass at all. Rather than let those
 * rows silently vanish from the roster, anything still unvisited afterward
 * is walked again as an extra root: each member still renders exactly once,
 * and the recursion still stops the instant it loops back to an id already
 * drawn.
 */
export function flattenUnitTree(units: LodgingUnitRecord[], sort: UnitSort): UnitTreeRow[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const childrenOf = new Map<string, LodgingUnitRecord[]>()
  const roots: LodgingUnitRecord[] = []

  for (const unit of units) {
    const parent = unit.parent_unit !== '' ? byId.get(unit.parent_unit) : undefined
    if (parent === undefined) {
      roots.push(unit)
      continue
    }
    const siblings = childrenOf.get(parent.id)
    if (siblings) siblings.push(unit)
    else childrenOf.set(parent.id, [unit])
  }

  const rows: UnitTreeRow[] = []
  const visited = new Set<string>()

  const walk = (level: LodgingUnitRecord[], depth: number) => {
    for (const unit of sortUnits(level, sort)) {
      if (visited.has(unit.id)) continue
      visited.add(unit.id)
      rows.push({ unit, depth })
      const children = childrenOf.get(unit.id)
      if (children) walk(children, depth + 1)
    }
  }

  walk(roots, 0)
  // Cycle members with no external entry point: never reached from a real
  // root, so pick them up here instead of losing them from the render.
  const stranded = units.filter((unit) => !visited.has(unit.id))
  if (stranded.length > 0) walk(stranded, 0)

  return rows
}
