/**
 * Weekend friend groups (kindred#1913 half 1).
 *
 * Friendly aliases over the generated FastAPI types, matching the convention
 * `types/lodging.ts` uses — import these rather than reaching into
 * `api-generated/` directly.
 *
 * NO `FriendGroupIntent` export, on purpose. A friend group is "lock these
 * households together," full stop — `with`/`near` is a property of whatever
 * later consumes a group, not of the group itself (owner ruling,
 * kindred#1913). See `api/schemas/lodging_friend_groups.py`.
 *
 * The unions that DO remain are DERIVED, never hand-written: a hand-copied
 * union here is exactly how a surface drifts from the wire contract.
 * `NonNullable<...>` makes a change to the Pydantic Literal a type error at
 * the read sites instead of a silently unreachable branch.
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
 * WHO authored the group. `staff_manual` is all anything writes today;
 * `proposed` is the seam a later solver or "processed requests" pipeline would
 * write through — see `api/services/lodging_friend_group_service.py` for what
 * that seam is and, more importantly, what it deliberately is not.
 */
export type FriendGroupSource = NonNullable<FriendGroup['source']>
