/**
 * Weekend friend groups (kindred#1913 half 1).
 *
 * Friendly aliases over the generated FastAPI types, matching the convention
 * `types/lodging.ts` uses — import these rather than reaching into
 * `api-generated/` directly.
 *
 * The unions are DERIVED, never hand-written. `intent` in particular is a
 * two-value Literal on the Python side, and a hand-copied union here is
 * exactly how a surface drifts from the wire contract: `NonNullable<...>`
 * makes a change to the Pydantic Literal a type error at the read sites
 * instead of a silently unreachable branch.
 *
 * GOTCHA, same as `types/lodging.ts`: a Pydantic field with a default renders
 * as OPTIONAL in TypeScript (`name: str = ""` -> `name?: string`). The server
 * always populates them; read sites still need `?? ''`.
 */

import type {
  FriendGroup,
  FriendGroupCreateRequest,
  FriendGroupListResponse,
  FriendGroupMember,
  FriendGroupUpdateRequest,
} from './api-generated'

/** One staff-authored group, with its household membership resolved. */
export type FriendGroupRow = FriendGroup
/** GET /api/lodging/friend-groups payload. */
export type FriendGroupList = FriendGroupListResponse
/** One household inside a group — a CampMinder id, never a PocketBase id. */
export type FriendGroupMemberRow = FriendGroupMember
/** POST body. */
export type FriendGroupCreate = FriendGroupCreateRequest
/** PATCH body. Every field optional; omitted means untouched. */
export type FriendGroupUpdate = FriendGroupUpdateRequest

/**
 * What placing this group would have to satisfy.
 *
 * `with` and `near` are DIFFERENT REQUESTS and must never collapse into one:
 * `near` is satisfied by distance between units, `with` only by putting both
 * parties in one room. A UI that renders them alike is the failure kindred#1913
 * names explicitly.
 *
 * Note this is NARROWER than `ProximityKindValue` in `types/lodging.ts`, which
 * is what the registration form can say (`near | with | similar_ages`).
 * `similar_ages` accompanies `with` rather than replacing it, and a group whose
 * members are named by a staff member cannot mean "somebody with kids about
 * this age".
 */
export type FriendGroupIntent = NonNullable<FriendGroup['intent']>

/**
 * WHO authored the group. `staff_manual` is all anything writes today;
 * `proposed` is the seam a later solver or "processed requests" pipeline would
 * write through — see `api/services/lodging_friend_group_service.py` for what
 * that seam is and, more importantly, what it deliberately is not.
 */
export type FriendGroupSource = NonNullable<FriendGroup['source']>
