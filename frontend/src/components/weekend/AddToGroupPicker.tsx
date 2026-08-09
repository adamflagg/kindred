/**
 * AddToGroupPicker — the "Add to group" control beside `FriendGroupActionBar`'s
 * "Create Group" button (kindred#1913 half 2, Option A).
 *
 * Summer chooses an "Add to existing" target by pre-selecting a group in the
 * side panel (`LockGroupPanel`), which sets `LockGroupContext.selectedGroupId`
 * and flips the action bar into add mode. The weekend board has no side panel
 * to select a group from, so the target is picked here instead, through the
 * same portal + filter-free listbox mechanics `AddHouseholdPicker` uses.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'

import type { FriendGroupRow } from '../../types/friendGroups'

export interface AddToGroupPickerProps {
  groups: FriendGroupRow[]
  onSelect: (groupId: string) => void
  disabled: boolean
}

export function AddToGroupPicker({ groups, onSelect, disabled }: AddToGroupPickerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setDropdownPos({ top: rect.top - 4, left: rect.left })
    }
    recompute()
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

  const handleSelect = (groupId: string) => {
    onSelect(groupId)
    setOpen(false)
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
        className="hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add to group
      </button>

      {open &&
        dropdownPos !== null &&
        createPortal(
          <div
            ref={dropdownRef}
            data-panel="add-to-group-picker"
            className="bg-background fixed z-50 w-[260px] -translate-y-full rounded-lg border shadow-lg"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            <div
              role="listbox"
              aria-label="Choose a friend group"
              className="max-h-48 overflow-y-auto"
            >
              {groups.map((group) => (
                <button
                  key={group.group_id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    handleSelect(group.group_id)
                  }}
                  className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed", exactly as in WeekendFriendGroups.tsx's own group-name fallback */}
                  <span className="truncate">{group.name || 'Unnamed group'}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
