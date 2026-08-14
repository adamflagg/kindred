/**
 * AddHouseholdPicker — the per-card "Add household" trigger and its filter
 * popover (kindred#1913).
 *
 * Ported from `LockGroupPanel.tsx`'s `AddMemberPicker` — trigger styling,
 * portal + fixed positioning recomputed on open/scroll/resize, outside-click
 * dismissal, and Escape handling all mirror it line for line.
 *
 * The eligibility rule excludes ONLY this group's own current members. It
 * does NOT exclude a household that is in some OTHER group: the owner ruled
 * on 2026-08-09 that multi-group tenancy behaves as summer's does, and
 * summer's add path (`LockGroupContext.addCamperToGroup`) warns and then
 * creates a second membership rather than refusing or moving. Such a
 * household is listed with the group it is already in, and `onAdd` raises
 * the warning. An earlier cut filtered them out silently and called the
 * picker "the gate" — which offered staff no way to express a legitimate
 * second group, and gave no reason for the absence.
 *
 * ⚠️ DELIBERATE DIVERGENCE FROM SUMMER, ruled by the owner 2026-08-09 after
 * the discrepancy was measured. Read this before "fixing" it back.
 *
 * Summer's own per-card picker does NOT warn — it hides. `AddMemberPicker`
 * (`LockGroupPanel.tsx`) filters on `!getCamperLockGroup(c.person_cm_id)`,
 * so a camper already in a group simply is not offered. The warn quoted
 * above lives in `addCamperToGroup`, which the board and action-bar paths
 * reach and that picker never does. So summer is internally inconsistent:
 * its board path warns, its picker hides.
 *
 * Copying summer literally here would have imported that inconsistency.
 * The owner chose consistency instead: all three weekend add paths warn and
 * keep both memberships. The reason is that a hidden household is
 * indistinguishable from one that is not on the weekend at all — staff
 * cannot tell "already grouped" from "not here", and the absence explains
 * nothing. Per the root CLAUDE.md §4 rule, this is the justification for
 * departing from the mature surface, stated at the divergence.
 *
 * Summer's gender filter does not come across: weekends do not split by
 * gender (see `FriendGroupActionBar.tsx`'s header).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'

import type { FriendGroupRow } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { householdLabel, pickableHouseholds } from './friendGroups'
import { useOverlayEscape } from '../../hooks/useOverlayEscape'

export interface AddHouseholdPickerProps {
  groupName: string
  /** Every household on this weekend. */
  households: RosterPartyRow[]
  /** This group's current members — the only households the picker hides. */
  memberCmIds: Set<number>
  /** household_cm_id -> a group it already belongs to, if any. Label only. */
  householdToGroup: Map<number, FriendGroupRow>
  /**
   * True while any friend-group write is in flight or its refetch is still
   * out. `memberCmIds` and the membership `onAdd` computes are both read from
   * the CACHED group, so a second add over a list the first one already
   * changed would send an absolute `household_cm_ids` that deletes it again.
   * Summer's `AddMemberPicker` needs no equivalent: its add is a single
   * `locked_group_members` create, so two of them compose.
   */
  disabled: boolean
  onAdd: (party: RosterPartyRow) => void
}

export function AddHouseholdPicker({
  groupName,
  households,
  memberCmIds,
  householdToGroup,
  disabled,
  onAdd,
}: AddHouseholdPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const eligible = pickableHouseholds(households, memberCmIds, filter)

  // Position recompute — runs on open, on window scroll (capture phase to
  // catch an inner scroller), and on resize, exactly as AddMemberPicker's.
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
    recompute()
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
  }, [open])

  // Outside-click dismissal.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setOpen(false)
      setFilter('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // kindred#2237: gated by the shared overlay token stack (kindred#2205)
  // rather than a capture-phase listener racing to beat an outer one — see
  // `useOverlayEscape` for why. Only the topmost registered overlay acts.
  const closeOnEscape = useCallback(() => {
    setOpen(false)
    setFilter('')
    triggerRef.current?.focus()
  }, [])
  useOverlayEscape(open, closeOnEscape)

  const handleSelect = (party: RosterPartyRow) => {
    onAdd(party)
    setOpen(false)
    setFilter('')
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o)
        }}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Add household to ${groupName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus className="h-3.5 w-3.5" />
        Add household
      </button>

      {open &&
        dropdownPos !== null &&
        createPortal(
          <div
            ref={dropdownRef}
            data-panel="add-household-picker"
            className="bg-background fixed z-50 w-[260px] rounded-lg border shadow-lg"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
              }}
              placeholder="Filter households…"
              className="w-full rounded-t-lg border-b px-3 py-2 text-sm outline-none"
            />
            <div role="listbox" className="max-h-48 overflow-y-auto">
              {eligible.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  {filter.trim() === ''
                    ? 'Every household on this weekend is already in this group.'
                    : 'No households match that filter.'}
                </p>
              ) : (
                eligible.map((party) => {
                  const otherGroup = householdToGroup.get(party.household_cm_id ?? 0)
                  return (
                    <button
                      key={party.household_cm_id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        handleSelect(party)
                      }}
                      className="hover:bg-muted w-full px-3 py-1.5 text-left text-sm"
                    >
                      <span className="block truncate">{householdLabel(party)}</span>
                      {/* Named, not hidden. The add is allowed and warned
                          about, so the reason it is worth a second look
                          belongs on the option itself. */}
                      {otherGroup && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed" */}
                          Already in “{otherGroup.name || 'Unnamed group'}”
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
