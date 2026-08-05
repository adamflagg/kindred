/**
 * Parent-unit relationships: who may be whose parent, and who currently is.
 *
 * The parent picker (`UnitIdentityFields`) has to reject two things the API
 * does not stop: setting a unit's parent to one of its own descendants — a
 * cycle `descendantIds`' own walk below and the Go-side `HasParentCycle`
 * would otherwise have to guard against every time they run — and a
 * non-container parent, which `scripts/dev/verify-lodging-seed.sh` treats as
 * a seed failure. Nothing else walks parent links: `descendantIds` below and
 * the Go-side `HasParentCycle` are the only two, and both carry visited
 * guards. The cycle case now has a server-side backstop too
 * (`guardUnitParentCycle`, #1899), for the direct write this picker can't
 * filter; the non-container case still has no PocketBase rule or Go hook at
 * all. This filters both before either ever reaches a write.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'

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
 * The unit's CURRENT parent survives the narrowing whatever area it is in.
 * Filtering a stored parent out of its own picker would leave the select with
 * no matching option, so it would fall to the first entry and the next save
 * would silently reparent a unit the staffer only meant to rename.
 */
export function parentCandidates(
  unitId: string | undefined,
  units: LodgingUnitRecord[],
  areaId?: string
): LodgingUnitRecord[] {
  const excluded = unitId === undefined ? new Set<string>() : descendantIds(unitId, units)
  const currentParent = units.find((u) => u.id === unitId)?.parent_unit ?? ''
  return units.filter(
    (candidate) =>
      candidate.is_container &&
      candidate.id !== unitId &&
      !excluded.has(candidate.id) &&
      (areaId === undefined || candidate.area === areaId || candidate.id === currentParent)
  )
}
