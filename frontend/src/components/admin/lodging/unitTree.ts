/**
 * Parent-unit relationships: who may be whose parent, and who currently is.
 *
 * The parent picker (`UnitIdentityFields`) has to reject two things the API
 * does not stop: setting a unit's parent to one of its own descendants — a
 * cycle `descendantIds`' own walk below and the Go-side `HasParentCycle`
 * would otherwise have to guard against every time they run — and a
 * non-container parent, which `scripts/dev/verify-lodging-seed.sh` treats as
 * a seed failure. JudgeMerge, the merge-legality rule, does not walk parent
 * links at all (one hop per member, then a flat scan), so a cycle cannot hang
 * it regardless. The cycle case now has a server-side backstop too
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
 */
export function parentCandidates(
  unitId: string | undefined,
  units: LodgingUnitRecord[]
): LodgingUnitRecord[] {
  const excluded = unitId === undefined ? new Set<string>() : descendantIds(unitId, units)
  return units.filter(
    (candidate) => candidate.is_container && candidate.id !== unitId && !excluded.has(candidate.id)
  )
}
