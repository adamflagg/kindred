/**
 * AddHouseholdPicker — the per-card "Add household" trigger and its filter
 * popover (kindred#1913 half 2, Option A).
 *
 * Ported from `LockGroupPanel.tsx`'s `AddMemberPicker` — trigger styling,
 * portal + fixed positioning recomputed on open/scroll/resize, outside-click
 * dismissal, and Escape handling all mirror it line for line. What differs
 * is the eligibility rule: summer excludes a camper already in ANY lock
 * group AND filters by gender to match the group's existing members; a
 * weekend group has no gender split (weekends do not split by gender — see
 * `FriendGroupActionBar.tsx`'s header), so this excludes ONLY households
 * already grouped (`ungroupedHouseholds` — the picker is the gate, per the
 * approved design).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'

import type { FriendGroupRow } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { householdLabel, ungroupedHouseholds } from './friendGroups'

export interface AddHouseholdPickerProps {
  groupName: string
  /** Every household on this weekend. */
  households: RosterPartyRow[]
  /** household_cm_id -> the group it already belongs to, if any. */
  householdToGroup: Map<number, FriendGroupRow>
  onAdd: (party: RosterPartyRow) => void
}

export function AddHouseholdPicker({
  groupName,
  households,
  householdToGroup,
  onAdd,
}: AddHouseholdPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const eligible = ungroupedHouseholds(households, householdToGroup, filter)

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

  // Escape dismisses the picker. Capture phase, same reason AddMemberPicker
  // gives: stop it before an outer modal listener reacts.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      setFilter('')
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

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
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        aria-label={`Add household to ${groupName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
              // eslint-disable-next-line jsx-a11y/no-autofocus -- deliberate, same as AddMemberPicker: this is a combobox-style picker opened by a button click, and the filter box is the only control in it
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
                  Every household on this weekend is already in a group.
                </p>
              ) : (
                eligible.map((party) => (
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
                    {householdLabel(party)}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
