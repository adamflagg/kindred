/**
 * Stable React identity for a roster party, shared by every weekend surface
 * that lists parties — the board, the map, the map's unit popover and the
 * unplaced queue. One definition, because four drifted into two variants and
 * one of them was wrong.
 *
 * ## `||`, never `??`
 *
 * `RosterParty` carries BOTH ids and fills the unused one with 0 — they are
 * Pydantic `int = 0`, so they are always serialised and the schema's own
 * docstring says "exactly one of household_cm_id / person_cm_id is non-zero".
 * The wire value for the grain a party is not is therefore `0`, not
 * `undefined`, and `0 ?? x` is `0`. Under `??` every party on an ADULT
 * weekend keys to `person-0` and React reconciles the whole queue as one row.
 *
 * `||` falls through 0 to the id that is actually set, and on to
 * `display_name` for a household whose record failed to resolve — the roster
 * service emits `household_cm_id = 0` for those too, so they collide the same
 * way and the name is the last thing left to tell them apart.
 */
import type { RosterPartyRow } from '../../types/lodging'

export function partyKey(party: RosterPartyRow): string {
  // The disable is the whole point: `prefer-nullish-coalescing` is WRONG here,
  // and taking its advice is the bug described above. Do not autofix this.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 0 is the real wire value for the unused grain, so `??` collides every party
  const id = party.household_cm_id || party.person_cm_id || party.display_name
  return `${party.grain}-${String(id)}`
}
