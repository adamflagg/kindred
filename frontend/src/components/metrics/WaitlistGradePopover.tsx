import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { WaitlistedPerson } from '../../hooks/useSessionAvailability'

export interface WaitlistGradePopoverProps {
  isOpen: boolean
  anchorRect: { top: number; left: number; width: number; height: number }
  grade: number
  genderLabel: string // "girls", "boys", or "" for AG
  persons: WaitlistedPerson[] // already filtered to this grade by parent
  onClose: () => void
}

function gradeLabel(grade: number): string {
  if (grade === 2) return '2nd'
  if (grade === 3) return '3rd'
  return `${grade}th`
}

function abbreviateName(person: WaitlistedPerson): string {
  const first = person.preferred_name || person.first_name
  const lastInitial = person.last_name.charAt(0)
  return `${first} ${lastInitial}.`
}

export function WaitlistGradePopover({
  isOpen,
  anchorRect,
  grade,
  genderLabel,
  persons,
  onClose,
}: WaitlistGradePopoverProps) {
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

  const top = anchorRect.top + anchorRect.height + 8
  const left = anchorRect.left

  const gradeLbl = gradeLabel(grade)
  const headerText = genderLabel
    ? `${persons.length} waitlisted ${gradeLbl}-grade ${genderLabel}`
    : `${persons.length} waitlisted ${gradeLbl}-grade`

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
        Position # is session waitlist order
      </div>
    </div>,
    document.body
  )
}
