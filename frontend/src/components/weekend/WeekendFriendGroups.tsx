/**
 * The weekend Groups tab — staff-authored friend groups (kindred#1913 half 1).
 *
 * A friend group here is a named set of HOUSEHOLDS, authored by a staff
 * member. Nothing on this surface parses a request, resolves a name, or
 * solves anything: the staff member is the resolver. The seam a later
 * proposer would arrive through is the row's `source` column and nothing
 * else — see `api/services/lodging_friend_group_service.py`.
 *
 * NO `intent`. A friend group is "lock these households together," full
 * stop — whether that means the same cabin or merely nearby is a property of
 * whatever later consumes the group (the solver tool half 2 of the issue
 * builds), not of the group itself. Owner ruling, kindred#1913.
 *
 * ## What came across from summer, and what did not
 *
 * Taken, per CLAUDE.md §4 and the issue's own table: the bottom action bar
 * (`LockGroupActionBar.tsx`), the nine group colours and their rotation, the
 * auto-name from surnames shown as a placeholder, and the `pending-lock-glow`
 * on a selected member card (`CamperCard.tsx`, `index.css:856`). That class is
 * used BARE — it is a hand-written `@layer utilities` rule, and a `hover:`
 * variant of one is the inert-class trap #1894 / #2091 describe. There is no
 * `hover:` form of it anywhere here.
 *
 * Not taken: the drag overlay and the drop wiring. A weekend group is not
 * placed by dragging it anywhere yet — there is no solver and no group-aware
 * placement — so a drag affordance would promise a behaviour that does not
 * exist. Adding it belongs with whatever consumes groups, not with authoring
 * them.
 *
 * ## Household grain, which the adult weekends do not have
 *
 * `RosterParty.grain` is `household` on a family weekend and `person` on an
 * adult one. A group is defined at household grain, so an adult weekend has
 * nothing to group and the tab says so rather than showing an empty picker
 * that can never fill.
 *
 * ## Membership add/remove
 *
 * The member CHIPS above became member ROWS with a remove control, mirroring
 * `LockGroupPanel.tsx`'s member list grammar — see `FriendGroupCard` below.
 * Adding is two entry points, also both ported from summer: the per-card
 * `AddHouseholdPicker` (`LockGroupPanel`'s `AddMemberPicker`) and the board's
 * `AddToGroupPicker` beside "Create Group" (`FriendGroupActionBar`'s summer
 * counterpart has "Add to existing" beside "Create group").
 *
 * ## Multi-group tenancy is summer's, exactly — owner ruling 2026-08-09
 *
 * All THREE write paths (create, the card picker, the board's "Add to group")
 * warn through the same `confirmIfGrouped`, and confirming ADDS a second
 * membership without touching the first. Nothing here deletes a membership
 * except the member row's X and Dissolve, which is the shape summer has:
 * `LockGroupContext.addCamperToGroup` only ever creates a row, and
 * `LockGroupActionBar`'s create mutation runs the same sequential pre-check
 * against the sentinel target `'__new__'`.
 *
 * The two-household floor is likewise a CREATE-time rule only, as summer's
 * is: `LockGroupPanel.removeMemberMutation` deletes a member unconditionally
 * and `getGroupValidationIssues` reports nothing for a group under two. An
 * earlier cut of this file MOVED a conflicted household — draining its old
 * group — which both diverged from summer for no stated reason and could
 * half-apply, since the drain 422'd on the floor after the add had landed.
 */
import { Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { Fragment, useMemo, useRef, useState } from 'react'

import { QueryGuard } from '../QueryGuard'
import { useFriendGroupMutations, useWeekendFriendGroups } from '../../hooks/useWeekendFriendGroups'
import { useHouseholdGroupConflictConfirm } from '../../hooks/useHouseholdGroupConflictConfirm'
import type { FriendGroupRow, FriendGroupUpdate } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { AddHouseholdPicker } from './AddHouseholdPicker'
import { FriendGroupActionBar } from './FriendGroupActionBar'
import { FriendGroupConflictDialog } from './FriendGroupConflictDialog'
import {
  defaultFriendGroupName,
  FRIEND_GROUP_COLOR_NAMES,
  FRIEND_GROUP_COLORS,
  friendGroupMemberLabels,
  householdGroupIndex,
  householdLabel,
  nextFriendGroupColor,
  partyComposition,
  withHousehold,
  withoutHousehold,
} from './friendGroups'

/**
 * Sentinel target for the CREATE path's conflict check, straight from
 * summer's `LockGroupActionBar`: the group does not exist yet, so no existing
 * membership can carry this id and every already-grouped household counts as
 * a conflict.
 */
const NEW_GROUP_SENTINEL = '__new__'

export interface WeekendFriendGroupsProps {
  year: number
  /** The weekend's CampMinder id. `0` means no weekend resolved yet. */
  sessionCmId: number
  /** The roster, already loaded by the page. Household-grain rows are used. */
  parties: RosterPartyRow[]
  /** `bunking.manage`. Without it the tab is a read-only list. */
  canManage: boolean
  /**
   * `WeekendSessionSummary.session_type`, e.g. `'adult'` or `'family'`.
   *
   * `households.length === 0` is ambiguous on its own: it is the PERMANENT
   * state of an adult weekend (person grain, nothing to group -- ever), and
   * it is ALSO the ordinary, temporary state of a family weekend nobody has
   * registered for yet. Without this the empty state told every zero-household
   * weekend "this weekend enrols individual guests rather than households",
   * which is simply false for the second case.
   */
  sessionType: string
}

/** One group's card, with the inline editor its Rename button opens. */
function FriendGroupCard({
  group,
  byHouseholdCmId,
  households,
  householdToGroup,
  canManage,
  onUpdate,
  onDissolve,
  onAddMember,
  onRemoveMember,
  isPending,
}: {
  group: FriendGroupRow
  byHouseholdCmId: Map<number, RosterPartyRow>
  /** Every household on this weekend — passed through to the add picker. */
  households: RosterPartyRow[]
  /** household_cm_id -> a group it's already in, for the picker's warning label. */
  householdToGroup: Map<number, FriendGroupRow>
  canManage: boolean
  onUpdate: (groupId: string, body: FriendGroupUpdate) => void
  onDissolve: (groupId: string) => void
  onAddMember: (group: FriendGroupRow, party: RosterPartyRow) => void
  onRemoveMember: (group: FriendGroupRow, householdCmId: number) => void
  isPending: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(group.name ?? '')
  const [draftColor, setDraftColor] = useState(group.color ?? FRIEND_GROUP_COLORS[0])

  // Disambiguated labels for the member chips below — see
  // `friendGroupMemberLabels`. Built only from members still on the roster;
  // a household that left it already gets its own "no longer enrolled" chip
  // and has no label to collide with.
  const memberLabels = useMemo(
    () =>
      friendGroupMemberLabels(
        (group.members ?? [])
          .map((member) => byHouseholdCmId.get(member.household_cm_id))
          .filter((party): party is RosterPartyRow => party !== undefined)
      ),
    [group.members, byHouseholdCmId]
  )

  // The only households the add picker hides: this group's own members, for
  // which an add is a no-op. Anything already in ANOTHER group stays on offer
  // and is warned about instead — see `AddHouseholdPicker`'s header.
  const memberCmIds = useMemo(
    () => new Set((group.members ?? []).map((member) => member.household_cm_id)),
    [group.members]
  )

  function openEditor() {
    setDraftName(group.name ?? '')
    setDraftColor(group.color ?? FRIEND_GROUP_COLORS[0])
    setIsEditing(true)
  }

  /**
   * Send ONLY what changed. A PATCH that echoed the whole group back would
   * turn a recolour into a rewrite of the name too — the mirror image of the
   * server's `exclude_unset`, which exists to make that impossible from here.
   * An unchanged field is omitted; a name cleared to '' is a real edit,
   * meaning "fall back to the auto-name", and is sent.
   */
  function save() {
    const body: FriendGroupUpdate = {}
    if (draftName !== (group.name ?? '')) body.name = draftName
    if (draftColor !== (group.color ?? '')) body.color = draftColor
    if (Object.keys(body).length > 0) onUpdate(group.group_id, body)
    setIsEditing(false)
  }

  return (
    <div
      data-testid={`friend-group-${group.group_id}`}
      className="card-lodge border-l-4 p-3"
      style={{ borderLeftColor: group.color }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="h-3 w-3 flex-shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
        <span className="text-foreground text-sm font-semibold">
          {/* `||`, NOT `??` — and the disable is the point, exactly as in
              `partyKey.ts`. A blank name is the ORDINARY state here: the
              server stores '' when staff clear the field, meaning "fall back".
              `??` passes '' straight through and renders an empty heading. */}
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed", so `??` would render a blank heading */}
          {group.name || 'Unnamed group'}
        </span>
        {/* The seam, made visible. A group a machine proposed must never read
            as one a staff member authored. Nothing writes this today. */}
        {group.source === 'proposed' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
            Proposed
          </span>
        )}
        {canManage && !isEditing && (
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={openEditor}
              className="hover:bg-muted rounded-lg border px-2 py-1 text-xs transition-colors"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                onDissolve(group.group_id)
              }}
              disabled={isPending}
              className="text-destructive hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Dissolve
            </button>
          </span>
        )}
      </div>

      {/* Member rows — summer's `LockGroupPanel` grammar exactly (row, primary
          line, secondary composition line, remove control), over households
          rather than campers. Replaces the old member CHIPS, which carried
          only a bare label and no way to act on a member at all. */}
      <div className="mt-3 space-y-2">
        {(group.members ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No households in this group yet.</p>
        ) : (
          (group.members ?? []).map((member) => {
            const party = byHouseholdCmId.get(member.household_cm_id)
            const label = party
              ? (memberLabels.get(member.household_cm_id) ?? householdLabel(party))
              : ''

            if (!party) {
              // NAMED, not dropped. A household that cancelled after the group
              // was authored is exactly the case a staff member has to notice —
              // silently shrinking the group to the survivors would hide it.
              // There is no composition line to show: the roster has nothing
              // left to report for a household that isn't on it any more.
              return (
                <div
                  key={member.household_cm_id}
                  className="flex items-center justify-between rounded border border-amber-200 bg-amber-100 p-2 dark:border-amber-900/50 dark:bg-amber-900/50"
                >
                  <p className="truncate text-sm text-amber-800 dark:text-amber-300">
                    Household {member.household_cm_id} · no longer enrolled
                  </p>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        onRemoveMember(group, member.household_cm_id)
                      }}
                      className="hover:bg-muted flex-shrink-0 rounded p-1"
                      title="Remove from group"
                      aria-label={`Remove household ${String(member.household_cm_id)} from group`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            }

            return (
              <div
                key={member.household_cm_id}
                className="bg-background flex items-center justify-between rounded border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="text-muted-foreground text-xs">{partyComposition(party)}</p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveMember(group, member.household_cm_id)
                    }}
                    className="hover:bg-muted flex-shrink-0 rounded p-1"
                    title="Remove from group"
                    aria-label={`Remove ${label} from group`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })
        )}
        {canManage && (
          <AddHouseholdPicker
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
            groupName={group.name || 'this group'}
            households={households}
            memberCmIds={memberCmIds}
            householdToGroup={householdToGroup}
            onAdd={(party) => {
              onAddMember(group, party)
            }}
          />
        )}
      </div>

      {isEditing && (
        <div className="border-border/60 mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <input
            type="text"
            aria-label="Group name"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value)
            }}
            placeholder="Group name"
            className="bg-background focus:ring-primary/50 w-44 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
          />
          <fieldset className="flex items-center gap-1.5">
            <legend className="sr-only">Group colour</legend>
            {FRIEND_GROUP_COLORS.map((candidate) => (
              <label key={candidate} className="cursor-pointer">
                <input
                  type="radio"
                  name={`friend-group-color-${group.group_id}`}
                  value={candidate}
                  checked={draftColor === candidate}
                  onChange={() => {
                    setDraftColor(candidate)
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={clsx(
                    'block h-5 w-5 rounded-full transition-all',
                    draftColor === candidate && 'ring-foreground scale-110 ring-2 ring-offset-2'
                  )}
                  style={{ backgroundColor: candidate }}
                />
                <span className="sr-only">{FRIEND_GROUP_COLOR_NAMES[candidate] ?? candidate}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={save}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditing(false)
            }}
            className="hover:bg-muted rounded-lg border px-3 py-1.5 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export function WeekendFriendGroups({
  year,
  sessionCmId,
  parties,
  canManage,
  sessionType,
}: WeekendFriendGroupsProps) {
  const groupsQuery = useWeekendFriendGroups(year, sessionCmId)
  const { createGroup, updateGroup, updateGroupAsync, deleteGroup, isPending } =
    useFriendGroupMutations(year, sessionCmId)
  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data])

  // household_cm_id -> a group it's already in, if any — the conflict check
  // behind all three write paths, and the label the warning names.
  const householdToGroup = useMemo(() => householdGroupIndex(groups), [groups])

  const conflictConfirm = useHouseholdGroupConflictConfirm()

  // Re-entrancy guard for the bulk "Add to group" flow, matching summer's
  // LockGroupActionBar.handleAddToExisting: a ref for the synchronous check
  // (state would race React's render scheduling on a rapid double-click) and
  // state to drive the disabled trigger.
  const isAddingToGroupRef = useRef(false)
  const [isAddingToGroup, setIsAddingToGroup] = useState(false)

  // The same guard on the create path, which is now also awaitable: without
  // it a double-click during the conflict dialog would open a second one and
  // cancel the first awaiter (`confirmAdd` releases a pending resolver), so
  // half the selection would be confirmed against a dialog nobody saw.
  const isCreatingRef = useRef(false)

  // A Set, not an array: it preserves insertion order in JS, so the created
  // group's membership arrives in the order staff picked it, and membership
  // tests stay O(1) across a roster of several hundred households.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | null>(null)

  /**
   * DROP THE SELECTION WHEN THE WEEKEND CHANGES.
   *
   * The weekend switcher navigates to `/weekend/:otherRef/:view`, which
   * re-renders this same route element rather than remounting it — so nothing
   * resets this state on its own. Households picked on one weekend would stay
   * selected on the next, and the action bar would author them against a
   * weekend they are not enrolled in. (`selected` filters against the new
   * roster, so the visible count would silently shrink rather than error,
   * which is worse: it looks deliberate.)
   *
   * Adjusted DURING render rather than in an effect — the "storing information
   * from previous renders" pattern the React docs give for exactly this shape,
   * and the same one `WeekendRosterPage`'s `openedViews` uses one level up. It
   * is self-terminating: once `lastSessionCmId` matches, the branch is false
   * on the very next render.
   */
  const [lastSessionCmId, setLastSessionCmId] = useState(sessionCmId)
  if (lastSessionCmId !== sessionCmId) {
    setLastSessionCmId(sessionCmId)
    setSelectedIds(new Set())
    setName('')
    setColor(null)
  }

  // Rotates by how many groups the weekend already has, exactly as summer's
  // does, until staff pick one. At component scope rather than inside the
  // QueryGuard's render prop, because `handleCreate` reads it too.
  const activeColor = color ?? nextFriendGroupColor(groups.length)

  const households = useMemo(
    () => parties.filter((party) => party.grain === 'household'),
    [parties]
  )

  const byHouseholdCmId = useMemo(() => {
    const map = new Map<number, RosterPartyRow>()
    for (const party of households) map.set(party.household_cm_id ?? 0, party)
    return map
  }, [households])

  const selected = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => byHouseholdCmId.get(id))
        .filter((party): party is RosterPartyRow => party !== undefined),
    [selectedIds, byHouseholdCmId]
  )

  function toggle(householdCmId: number) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(householdCmId)) next.delete(householdCmId)
      else next.add(householdCmId)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setName('')
    setColor(null)
  }

  /**
   * Warn about one household that is already in some OTHER group.
   *
   * Returns `false` if staff cancelled. Shared by all three write paths, so
   * the same sentence appears whether the household came from the card
   * picker, the board's "Add to group", or a fresh Create — summer warns on
   * every one of its equivalents too (`addCamperToGroup` for the first two,
   * the create mutation's own pre-check for the third).
   */
  async function confirmIfGrouped(
    party: RosterPartyRow,
    targetGroupId: string,
    targetGroupName: string
  ): Promise<boolean> {
    const existingGroup = householdToGroup.get(party.household_cm_id ?? 0)
    if (!existingGroup || existingGroup.group_id === targetGroupId) return true
    const outcome = await conflictConfirm.confirmAdd({
      householdName: householdLabel(party),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
      existingGroupName: existingGroup.name || 'another friend group',
      targetGroupName,
    })
    return outcome === 'confirmed'
  }

  /**
   * Per-card picker. The picker no longer hides an already-grouped household
   * (owner ruling 2026-08-09), so a conflict IS reachable here — warn, then
   * append. Nothing is removed from the other group: summer's
   * `addCamperToGroup` only ever creates a membership row, and the only two
   * deletes on this surface are the member row's X and Dissolve.
   */
  async function handleAddMember(group: FriendGroupRow, party: RosterPartyRow) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
    const ok = await confirmIfGrouped(party, group.group_id, group.name || 'this group')
    if (!ok) return
    updateGroup(group.group_id, {
      household_cm_ids: withHousehold(group.members ?? [], party.household_cm_id ?? 0),
    })
  }

  // Member row's X button.
  function handleRemoveMember(group: FriendGroupRow, householdCmId: number) {
    updateGroup(group.group_id, {
      household_cm_ids: withoutHousehold(group.members ?? [], householdCmId),
    })
  }

  /**
   * The board's "Add to group": add every currently-selected household to
   * `targetGroupId`, in ONE PATCH to that group and nothing else.
   *
   * NO SOURCE-GROUP DRAIN, and its absence fixes two defects at once. An
   * earlier cut treated a household already in another group as a MOVE — a
   * second PATCH stripping it from that group. Neither summer path does
   * that (`LockGroupContext.addCamperToGroup` only creates a membership row;
   * the only two `locked_group_members` deletes in the tree are the explicit
   * per-member X and dissolve), and the drain was also the second way to
   * cross the two-household create floor: draining a group of two down to
   * one was rejected by the API AFTER the add to the target had already been
   * written, leaving a partial result no undo could reach. Owner ruling
   * 2026-08-09, "same behavior" as summer.
   *
   * Cancelling one household skips that household and KEEPS the selection,
   * which is summer's `handleAddToExisting` exactly — it clears pending only
   * when every add came back true.
   */
  async function addSelectedToGroup(targetGroupId: string) {
    if (isAddingToGroupRef.current) return
    const targetGroup = groups.find((g) => g.group_id === targetGroupId)
    if (!targetGroup) return

    isAddingToGroupRef.current = true
    setIsAddingToGroup(true)
    try {
      // `||`, not `??`: '' is the real stored value for an unnamed group
      // (same trap `partyKey.ts` documents at length), so `??` would let it
      // through as a blank dialog/label instead of falling back.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
      const targetName = targetGroup.name || 'this group'
      const existingTargetIds = (targetGroup.members ?? []).map((m) => m.household_cm_id)
      const targetIdSet = new Set(existingTargetIds)

      const toAdd: number[] = []
      let allConfirmed = true

      for (const party of selected) {
        const cmId = party.household_cm_id ?? 0
        if (targetIdSet.has(cmId)) continue // already a member of the target — nothing to do
        if (!(await confirmIfGrouped(party, targetGroupId, targetName))) {
          allConfirmed = false
          continue
        }
        toAdd.push(cmId)
      }

      if (toAdd.length === 0) return // nothing confirmed and nothing new — leave the selection as-is

      try {
        await updateGroupAsync(targetGroupId, {
          household_cm_ids: [...existingTargetIds, ...toAdd],
        })
        // Only once every household staff picked actually landed — summer
        // clears pending on `allSucceeded` for the same reason: a partial
        // add with the selection thrown away leaves nothing to retry from.
        if (allConfirmed) clearSelection()
      } catch {
        // Leave the selection intact on failure, exactly as "keeps the
        // selection when the create FAILS" does above — the mutation's own
        // onError already toasts the reason.
      }
    } finally {
      isAddingToGroupRef.current = false
      setIsAddingToGroup(false)
    }
  }

  /**
   * Create, with summer's sequential pre-check in front of it.
   *
   * `LockGroupActionBar`'s create mutation loops the pending campers BEFORE
   * writing anything, confirming each one already in a group against the
   * sentinel target `'__new__'`, and throws on the first cancel so no group
   * is created at all. The weekend had this check on its add path and not on
   * its create path, so authoring a second group over already-grouped
   * households happened silently.
   *
   * Cancelling ANY household aborts the WHOLE create — summer's behaviour,
   * and the only coherent one: the group's identity is the set staff picked,
   * so quietly authoring a smaller one is not what was asked for. The
   * selection survives, so they can drop the conflicting household and retry.
   */
  async function handleCreate() {
    if (isCreatingRef.current) return
    isCreatingRef.current = true
    try {
      // A blank field means "use the auto-name", which the bar shows as its
      // placeholder. The server stores what it is given, so the fallback is
      // applied HERE rather than left for the row to be renamed later.
      const finalName = name.trim() || defaultFriendGroupName(selected)
      for (const party of selected) {
        // `finalName` is a plain string, so `||` needs no lint exemption here:
        // it is '' when every selected household lacks a surname, and summer
        // falls back to the same literal in that case.
        const ok = await confirmIfGrouped(party, NEW_GROUP_SENTINEL, finalName || 'new group')
        if (!ok) return
      }
      createGroup(
        {
          year,
          session_cm_id: sessionCmId,
          name: finalName,
          color: activeColor,
          household_cm_ids: selected.map((party) => party.household_cm_id ?? 0),
        },
        // CLEARED ON SUCCESS ONLY, as summer's bar does. `mutate` is
        // fire-and-forget, so clearing straight after the call throws away
        // the whole selection and the typed name on a 403, a 400 or a
        // dropped connection — with nothing to undo it, and a toast that
        // says what failed but not what was lost.
        { onSuccess: clearSelection }
      )
    } finally {
      isCreatingRef.current = false
    }
  }

  return (
    <Fragment>
      <QueryGuard
        // `isPending`, NOT `isLoading`. A DISABLED query — `year` still 0 on a
        // cold load, or a slug the session list has not resolved yet — reports
        // `isLoading: false` with no data, which lands on QueryGuard's
        // no-data branch and tells staff there is nothing here for a weekend
        // nothing has been asked about. `isPending` is true for both the
        // in-flight and the not-yet-asked cases, which is what the user is
        // actually looking at.
        isLoading={groupsQuery.isPending}
        error={groupsQuery.error}
        data={groupsQuery.data}
        label="friend group"
        // Reached only if the server ever answers with no body. Named rather
        // than left as the generic "No data available", which reads as a fault.
        emptyMessage="No friend groups for this weekend."
      >
        {() => {
          if (households.length === 0) {
            return (
              <div className="space-y-3">
                <h2 className="text-foreground text-base font-semibold">Friend groups</h2>
                <p className="text-muted-foreground text-sm">
                  {sessionType === 'adult' ? (
                    <>
                      Friend groups are authored at household grain, and this weekend enrols
                      individual guests rather than households. There is nothing here to group.
                    </>
                  ) : (
                    <>
                      No households are registered for this weekend yet. Friend groups can be made
                      once families enrol.
                    </>
                  )}
                </p>
              </div>
            )
          }

          return (
            <div className={clsx('space-y-6', selected.length > 0 && 'pb-24')}>
              <section className="space-y-2">
                <h2 className="text-foreground text-base font-semibold">
                  Friend groups ({groups.length})
                </h2>
                {groups.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {canManage
                      ? 'None yet. Pick two or more families below to make one.'
                      : 'None yet.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {groups.map((group) => (
                      <FriendGroupCard
                        key={group.group_id}
                        group={group}
                        byHouseholdCmId={byHouseholdCmId}
                        households={households}
                        householdToGroup={householdToGroup}
                        canManage={canManage}
                        onUpdate={updateGroup}
                        onDissolve={deleteGroup}
                        onAddMember={(g, party) => {
                          void handleAddMember(g, party)
                        }}
                        onRemoveMember={handleRemoveMember}
                        isPending={isPending}
                      />
                    ))}
                  </div>
                )}
              </section>

              {canManage && (
                <section className="space-y-2">
                  <h2 className="text-foreground text-base font-semibold">Families</h2>
                  <div
                    data-testid="friend-group-households"
                    className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"
                  >
                    {households.map((party) => {
                      const cmId = party.household_cm_id ?? 0
                      const isSelected = selectedIds.has(cmId)
                      return (
                        <button
                          key={cmId}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            toggle(cmId)
                          }}
                          className={clsx(
                            'bg-card rounded-lg border p-2 text-left transition-all',
                            isSelected
                              ? // BARE, not a `hover:` variant. `pending-lock-glow` is a
                                // hand-written @layer utilities rule (index.css:856) and
                                // Tailwind v4 never emits `hover:` forms of those — the
                                // inert-class trap of #1894 / #2091.
                                'pending-lock-glow border-amber-400 dark:border-amber-500'
                              : 'hover:border-primary/50'
                          )}
                        >
                          <span className="text-foreground block truncate text-sm font-semibold">
                            {householdLabel(party)}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {(party.children ?? [])
                              .map((child) => child.display_name)
                              .join(' · ') || `${String(party.party_size ?? 0)} in party`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}

              {canManage && (
                <FriendGroupActionBar
                  selected={selected}
                  name={name}
                  onNameChange={setName}
                  color={activeColor}
                  onColorChange={setColor}
                  onClear={clearSelection}
                  onCreate={() => {
                    void handleCreate()
                  }}
                  isPending={isPending}
                  groups={groups}
                  onAddToGroup={(groupId) => {
                    void addSelectedToGroup(groupId)
                  }}
                  isAddingToGroup={isAddingToGroup}
                />
              )}
            </div>
          )
        }}
      </QueryGuard>
      <FriendGroupConflictDialog
        isOpen={conflictConfirm.dialogState.isOpen}
        householdName={conflictConfirm.dialogState.householdName}
        existingGroupName={conflictConfirm.dialogState.existingGroupName}
        targetGroupName={conflictConfirm.dialogState.targetGroupName}
        onConfirm={conflictConfirm.dialogState.onConfirm}
        onCancel={conflictConfirm.dialogState.onCancel}
      />
    </Fragment>
  )
}
