import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { WaitlistedPerson } from '../../hooks/useSessionAvailability'

interface WaitlistTooltipProps {
  isVisible: boolean
  position: { x: number; y: number }
  totalCount: number
  genderLabel: string // "girls", "boys", or "" for AG
  persons: WaitlistedPerson[]
}

function gradeLabel(grade: number | null | undefined): string {
  if (grade == null) return ''
  if (grade === 2) return '2nd'
  if (grade === 3) return '3rd'
  return `${grade}th`
}

function abbreviateName(person: WaitlistedPerson): string {
  const first = person.preferred_name || person.first_name
  const lastInitial = person.last_name.charAt(0)
  return `${first} ${lastInitial}.`
}

export function WaitlistTooltip({
  isVisible,
  position,
  totalCount,
  genderLabel: gender,
  persons,
}: WaitlistTooltipProps) {
  const tooltipPosition = useMemo(() => {
    if (!isVisible || position.x <= 0 || position.y <= 0) {
      return { top: 0, left: 0 }
    }

    const tooltipWidth = 240
    const tooltipHeight = 180
    const padding = 10

    let left = position.x + padding
    let top = position.y + padding

    if (left + tooltipWidth > window.innerWidth) {
      left = position.x - tooltipWidth - padding
    }
    if (top + tooltipHeight > window.innerHeight) {
      top = Math.max(padding, position.y - tooltipHeight - padding)
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding))
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding))

    return { top, left }
  }, [position.x, position.y, isVisible])

  if (!isVisible) return null

  const remaining = totalCount - persons.length
  const headerText = gender ? `${totalCount} ${gender} on waitlist` : `${totalCount} on waitlist`

  return createPortal(
    <div
      className="bg-popover pointer-events-none fixed z-[100] max-w-[260px] min-w-[180px] rounded-lg border p-3 shadow-lg"
      style={{
        position: 'fixed',
        top: `${tooltipPosition.top}px`,
        left: `${tooltipPosition.left}px`,
      }}
    >
      <div className="text-foreground mb-2 border-b pb-1.5 text-xs font-bold">{headerText}</div>
      <div className="space-y-0.5 text-xs">
        {persons.map((person) => (
          <div key={person.person_id} className="flex items-baseline justify-between gap-2">
            <span>
              <span className="text-muted-foreground font-semibold">#{person.position}</span>{' '}
              {abbreviateName(person)}
            </span>
            {person.grade != null && (
              <span className="text-muted-foreground text-[10px]">{gradeLabel(person.grade)}</span>
            )}
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <div className="text-muted-foreground mt-2 border-t pt-1.5 text-center text-[10px]">
          + {remaining} more — click for full list
        </div>
      )}
    </div>,
    document.body
  )
}
