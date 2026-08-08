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
