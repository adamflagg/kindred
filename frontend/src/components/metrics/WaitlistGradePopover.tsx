import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { WaitlistedPerson } from '../../hooks/useSessionAvailability'

export interface WaitlistGradePopoverProps {
  isOpen: boolean
  anchorRect: { top: number; left: number; width: number; height: number }
  grade: number
  totalGradeCount?: number // actual count from waitlisted_by_grade (may exceed persons.length)
  genderLabel: string // "girls", "boys", or "" for AG
  persons: WaitlistedPerson[] // already filtered to this grade by parent (may be partial from top-5)
  onClose: () => void
}

function gradeLabel(grade: number): string {
  if (grade === 2) return '2nd'
  if (grade === 3) return '3rd'
  return `${grade}th`
}

function abbreviateName(person: WaitlistedPerson): string {
  const first = person.preferred_name ?? person.first_name
  const lastInitial = person.last_name.charAt(0)
  return `${first} ${lastInitial}.`
}

export function WaitlistGradePopover({
  isOpen,
  anchorRect,
  grade,
  totalGradeCount,
  genderLabel,
  persons,
  onClose,
}: WaitlistGradePopoverProps) {
  // CORRECT AS-IS, no overlay token (kindred#2237): this component is not
  // rendered by any production surface. The only non-test reference anywhere
  // in `src/` is to `transformWaitlistGradeData`, a same-prefixed function in
  // `pages/metrics/registration/WaitlistAnalysis.tsx`. It cannot co-occur with
  // another overlay because nothing mounts it.
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      const popover = document.getElementById('waitlist-grade-popover')
      if (popover && !popover.contains(target)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const popoverWidth = 260
  const popoverHeight = Math.min(persons.length * 24 + 80, 320)
  const padding = 10

  let top = anchorRect.top + anchorRect.height + 8
  let left = anchorRect.left

  // Flip above anchor if clipped at bottom
  if (top + popoverHeight > window.innerHeight - padding) {
    top = Math.max(padding, anchorRect.top - popoverHeight - 8)
  }
  // Shift left if clipped at right
  if (left + popoverWidth > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - popoverWidth - padding)
  }

  const gradeLbl = gradeLabel(grade)
  const displayCount = totalGradeCount ?? persons.length
  const isPartial = persons.length < displayCount
  const headerText = genderLabel
    ? `${displayCount} waitlisted ${gradeLbl}-grade ${genderLabel}`
    : `${displayCount} waitlisted ${gradeLbl}-grade`

  return createPortal(
    <div
      id="waitlist-grade-popover"
      role="dialog"
      aria-label={headerText}
      className="bg-popover fixed z-[200] max-w-[300px] min-w-[220px] rounded-lg border p-3 shadow-lg"
      style={{
        top: `${top}px`,
        left: `${left}px`,
      }}
    >
      <div className="text-foreground mb-2 border-b pb-1.5 text-xs font-bold">{headerText}</div>
      <div className="space-y-0.5 text-xs">
        {persons.map((person) => (
          <div key={person.person_id} className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-semibold">#{person.position}</span>
            <span>{abbreviateName(person)}</span>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-2 border-t pt-1.5 text-[10px]">
        {isPartial
          ? `Showing ${persons.length} of ${displayCount} — click WL pill for full list`
          : 'Position # is session waitlist order'}
      </div>
    </div>,
    document.body
  )
}
