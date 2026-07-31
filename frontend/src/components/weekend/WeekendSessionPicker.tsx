/**
 * Weekend selector across both program types.
 *
 * The camp runs a number of `family` sessions a year and two `adult` sessions.
 * They share one lodging inventory, so they share one picker — but the type is
 * labelled, because a family session's parties are households and an adult
 * session's are individuals.
 */
import type { WeekendSession } from '../../types/lodging'

export interface WeekendSessionPickerProps {
  sessions: WeekendSession[]
  selectedCmId: number | null
  onSelect: (sessionCmId: number) => void
}

export function WeekendSessionPicker({
  sessions,
  selectedCmId,
  onSelect,
}: WeekendSessionPickerProps) {
  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No family or adult sessions found for this year.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Weekend selector">
      {sessions.map((session) => {
        const isSelected = session.session_cm_id === selectedCmId
        return (
          <button
            key={session.session_cm_id}
            type="button"
            onClick={() => {
              onSelect(session.session_cm_id)
            }}
            aria-pressed={isSelected}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted/50 text-foreground'
            }`}
          >
            <span>{session.name}</span>
            <span className="text-muted-foreground ml-2 text-xs">
              {session.session_type === 'adult' ? 'Adult' : 'Family'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
