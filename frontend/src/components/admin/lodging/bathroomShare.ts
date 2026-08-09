/**
 * Who shares a bathroom with whom, and what has to be WRITTEN to say so.
 *
 * Staff answer "which other rooms share this bathroom?". Storage answers it
 * with one `bathroom_group` string per unit, so the two are not the same
 * shape: an assertion made on one room's form is only true once every other
 * room in the group carries the same string. The owner ruled the writes
 * SYMMETRIC (kindred#2023) — adding and, explicitly, REMOVING.
 *
 * The group id itself is never shown. It stays exactly as stored, because
 * the merged-pair scoring path (#2022, #2170) reads that column and a
 * presentation change must not move it.
 *
 * WHY REMOVAL IS THE DANGEROUS DIRECTION. `bathroom_group` has nowhere to
 * store a one-sided claim, so a non-symmetric removal leaves the peer alone
 * in the group — a group of one, which is precisely the state a mistyped id
 * used to produce and which this feature exists to eliminate. Dissolving a
 * share must therefore clear every record in it, not just the edited one.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'

import { directChildren } from './unitTree'

/** One peer record to rewrite, with the name the staffer will be told about. */
export interface BathroomPeerWrite {
  id: string
  name: string
  bathroom_group: string
}

/**
 * The other units already carrying `unit`'s group id — the chips a form opens
 * with. Empty on create, and empty for a unit in no group.
 *
 * NOT filtered to siblings. The chips are the membership as stored, whatever
 * shape it is; only the ADD picker is parent-scoped. Production has no
 * cross-parent group today, and hiding one if it appeared would let a staffer
 * dissolve a share they could not see.
 */
export function storedPeerIds(
  unit: LodgingUnitRecord | undefined,
  units: LodgingUnitRecord[]
): string[] {
  if (!unit || unit.bathroom_group === '') return []
  return units
    .filter((other) => other.id !== unit.id && other.bathroom_group === unit.bathroom_group)
    .map((other) => other.id)
}

/**
 * Rooms that may still be added: the other rooms under the same parent.
 *
 * `directChildren` matches on `parent_unit` (the PocketBase record id, not
 * `parent_code`), which is the list the question is actually about — every
 * one of the ten production groups is confined to one parent, and nine of
 * them already cover every sibling under it. So an EMPTY result is the
 * ordinary case, not an edge case, and the caller renders a disabled picker
 * rather than hiding the control.
 *
 * A sibling already carrying a DIFFERENT non-empty group is deliberately not
 * offered. Adding it would merge two bathrooms into one and strand whatever
 * remains of the other group — a move, not an add, and one made from that
 * room's own form by clearing it there first. The raw-id field this replaces
 * allowed exactly that silent merge; not offering it is the fix, not a
 * limitation.
 */
export function sharePeerCandidates(
  unitId: string | undefined,
  parentUnitId: string,
  peerIds: string[],
  units: LodgingUnitRecord[],
  storedGroup: string
): LodgingUnitRecord[] {
  if (parentUnitId === '') return []
  const listed = new Set(peerIds)
  return directChildren(parentUnitId, units).filter((candidate) => {
    if (candidate.id === unitId || listed.has(candidate.id)) return false
    return candidate.bathroom_group === '' || candidate.bathroom_group === storedGroup
  })
}

/**
 * The group id this unit and its listed rooms should carry once saved.
 *
 * Called only from an add/remove, never at mount — a stored group of one is
 * left exactly as it is and merely warned about, because silently rewriting a
 * column the staffer did not touch is not this form's business.
 *
 * No listed rooms means NO GROUP. Keeping the id on a unit nothing else
 * shares would leave the group-of-one behind under a different name.
 */
export function resolveShareGroupId(
  storedGroup: string,
  peerIds: string[],
  units: LodgingUnitRecord[],
  parent: LodgingUnitRecord | undefined
): string {
  if (peerIds.length === 0) return ''
  if (storedGroup !== '') return storedGroup

  const byId = new Map(units.map((unit) => [unit.id, unit]))
  for (const id of peerIds) {
    const existing = byId.get(id)?.bathroom_group
    if (existing !== undefined && existing !== '') return existing
  }

  // Nobody has a group yet, so one is derived. The parent's code is the
  // natural base — a group is rooms under one roof — but a second bathroom
  // under the same roof is the case the parent-checkbox alternative was
  // rejected for not expressing, so the base is suffixed rather than reused.
  const inUse = new Set(units.map((unit) => unit.bathroom_group).filter((group) => group !== ''))
  const base = parent?.code !== undefined && parent.code !== '' ? parent.code : 'bathroom-group'
  if (!inUse.has(base)) return base
  let suffix = 2
  while (inUse.has(`${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

/**
 * The peer records that must change for the on-screen membership to be true.
 *
 * Two halves, and the second is the one the owner named:
 *  - every listed room not already carrying `groupId` joins it;
 *  - every room that WAS in the stored group and is no longer listed is
 *    cleared. Without this half, removing a chip is a one-sided claim the
 *    column cannot hold, and the peer is left in a group of one.
 *
 * The edited unit is never in the result — it travels in the form's own
 * payload, which is the write that already existed.
 *
 * Returns [] whenever nothing changed, which is the overwhelmingly common
 * case: nine of the ten production groups are complete, so an ordinary edit
 * to a name or a bed count still costs exactly one write.
 */
export function sharePeerWrites(
  unitId: string | undefined,
  storedGroup: string,
  peerIds: string[],
  groupId: string,
  units: LodgingUnitRecord[]
): BathroomPeerWrite[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const listed = new Set(peerIds)
  const writes: BathroomPeerWrite[] = []

  for (const id of peerIds) {
    const peer = byId.get(id)
    if (!peer || peer.bathroom_group === groupId) continue
    writes.push({ id: peer.id, name: peer.name, bathroom_group: groupId })
  }

  if (storedGroup !== '') {
    for (const peer of units) {
      if (peer.id === unitId || listed.has(peer.id)) continue
      if (peer.bathroom_group !== storedGroup) continue
      writes.push({ id: peer.id, name: peer.name, bathroom_group: '' })
    }
  }

  return writes
}
