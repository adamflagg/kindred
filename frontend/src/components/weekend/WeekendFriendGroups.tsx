/**
 * The weekend Groups tab — staff-authored friend groups (kindred#1913 half 1).
 *
 * A friend group here is a named set of HOUSEHOLDS with a stated intent,
 * authored by a staff member. Nothing on this surface parses a request,
 * resolves a name, or solves anything: the staff member is the resolver. The
 * seam a later proposer would arrive through is the row's `source` column and
 * nothing else — see `api/services/lodging_friend_group_service.py`.
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
 */
import { Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { QueryGuard } from '../QueryGuard'
import { useFriendGroupMutations, useWeekendFriendGroups } from '../../hooks/useWeekendFriendGroups'
import type { FriendGroupIntent, FriendGroupRow, FriendGroupUpdate } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { FriendGroupActionBar } from './FriendGroupActionBar'
import {
  defaultFriendGroupName,
  FRIEND_GROUP_COLOR_NAMES,
  FRIEND_GROUP_COLORS,
  FRIEND_GROUP_INTENT_LABEL,
  householdLabel,
  nextFriendGroupColor,
} from './friendGroups'

export interface WeekendFriendGroupsProps {
  year: number
  /** The weekend's CampMinder id. `0` means no weekend resolved yet. */
  sessionCmId: number
  /** The roster, already loaded by the page. Household-grain rows are used. */
  parties: RosterPartyRow[]
  /** `bunking.manage`. Without it the tab is a read-only list. */
  canManage: boolean
}

/** One group's card, with the inline editor its Rename button opens. */
function FriendGroupCard({
  group,
  byHouseholdCmId,
  canManage,
  onUpdate,
  onDissolve,
  isPending,
}: {
  group: FriendGroupRow
  byHouseholdCmId: Map<number, RosterPartyRow>
  canManage: boolean
  onUpdate: (groupId: string, body: FriendGroupUpdate) => void
  onDissolve: (groupId: string) => void
  isPending: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(group.name ?? '')
  const [draftColor, setDraftColor] = useState(group.color ?? FRIEND_GROUP_COLORS[0])

  const intent: FriendGroupIntent = group.intent ?? 'with'

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
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
          {FRIEND_GROUP_INTENT_LABEL[intent]}
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(group.members ?? []).map((member) => {
          const party = byHouseholdCmId.get(member.household_cm_id)
          return party ? (
            <span
              key={member.household_cm_id}
              className="bg-muted text-foreground rounded-full px-2 py-0.5 text-xs"
            >
              {householdLabel(party)}
            </span>
          ) : (
            // NAMED, not dropped. A household that cancelled after the group
            // was authored is exactly the case a staff member has to notice —
            // silently shrinking the group to the survivors would hide it.
            <span
              key={member.household_cm_id}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
            >
              Household {member.household_cm_id} · no longer enrolled
            </span>
          )
        })}
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
}: WeekendFriendGroupsProps) {
  const groupsQuery = useWeekendFriendGroups(year, sessionCmId)
  const { createGroup, updateGroup, deleteGroup, isPending } = useFriendGroupMutations(
    year,
    sessionCmId
  )

  // A Set, not an array: it preserves insertion order in JS, so the created
  // group's membership arrives in the order staff picked it, and membership
  // tests stay O(1) across a roster of several hundred households.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [name, setName] = useState('')
  const [intent, setIntent] = useState<FriendGroupIntent>('with')
  const [color, setColor] = useState<string | null>(null)

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

  return (
    <QueryGuard
      isLoading={groupsQuery.isLoading}
      error={groupsQuery.error}
      data={groupsQuery.data}
      label="friend group"
    >
      {(list) => {
        const groups = list.groups ?? []
        // Rotates by how many the weekend already has, exactly as summer's
        // does, until staff pick one for this group.
        const activeColor = color ?? nextFriendGroupColor(groups.length)

        if (households.length === 0) {
          return (
            <div className="space-y-3">
              <h2 className="text-foreground text-base font-semibold">Friend groups</h2>
              <p className="text-muted-foreground text-sm">
                Friend groups are authored at household grain, and this weekend enrols individual
                guests rather than households. There is nothing here to group.
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
                      canManage={canManage}
                      onUpdate={updateGroup}
                      onDissolve={deleteGroup}
                      isPending={isPending}
                    />
                  ))}
                </div>
              )}
            </section>

            {canManage && (
              <section className="space-y-2">
                <h2 className="text-foreground text-base font-semibold">Families</h2>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
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
                          {(party.children ?? []).map((child) => child.display_name).join(' · ') ||
                            `${String(party.party_size ?? 0)} in party`}
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
                intent={intent}
                onIntentChange={setIntent}
                onClear={clearSelection}
                onCreate={() => {
                  createGroup({
                    year,
                    session_cm_id: sessionCmId,
                    // A blank field means "use the auto-name", which the bar
                    // shows as its placeholder. The server stores what it is
                    // given, so the fallback is applied HERE rather than left
                    // for the row to be renamed later.
                    name: name.trim() || defaultFriendGroupName(selected),
                    color: activeColor,
                    intent,
                    household_cm_ids: selected.map((party) => party.household_cm_id ?? 0),
                  })
                  clearSelection()
                }}
                isPending={isPending}
              />
            )}
          </div>
        )
      }}
    </QueryGuard>
  )
}
