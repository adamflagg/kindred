/**
 * Weekend selector across both program types.
 *
 * The camp runs a dozen family sessions a year and two adult weekends. They
 * share one lodging inventory, so they share one picker — but the type stays
 * labelled, because a family session's parties are households and an adult
 * session's are individuals.
 *
 * This is a control, not content. Staff choose a weekend once and then work
 * inside it for an hour, so it stays one line instead of spending the top
 * third of the page on twelve near-identical buttons. The weekend's identity
 * belongs in the page header, where it reads as context rather than as one
 * option among equals.
 */
import { ChevronDown } from 'lucide-react'

import type { WeekendSession } from '../../types/lodging'
import { formatSessionDates } from './sessionDates'

export interface WeekendSessionPickerProps {
  sessions: WeekendSession[]
  selectedCmId: number | null
  onSelect: (sessionCmId: number) => void
}

function optionLabel(session: WeekendSession): string {
  const dates = formatSessionDates(session.start_date, session.end_date)
  return dates.length > 0 ? `${session.name} — ${dates}` : session.name
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

  const family = sessions.filter((s) => s.session_type !== 'adult')
  const adult = sessions.filter((s) => s.session_type === 'adult')

  return (
    <div className="relative inline-flex w-full max-w-md items-center">
      <select
        aria-label="Weekend"
        value={selectedCmId === null ? '' : String(selectedCmId)}
        onChange={(event) => {
          onSelect(Number(event.target.value))
        }}
        className="border-border bg-card text-foreground focus-visible:ring-ring w-full appearance-none rounded-lg border-2 py-2 pr-9 pl-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        <option value="" disabled>
          Choose a weekend…
        </option>
        {family.length > 0 && (
          <optgroup label="Family weekends">
            {family.map((session) => (
              <option key={session.session_cm_id} value={String(session.session_cm_id)}>
                {optionLabel(session)}
              </option>
            ))}
          </optgroup>
        )}
        {adult.length > 0 && (
          <optgroup label="Adult weekends">
            {adult.map((session) => (
              <option key={session.session_cm_id} value={String(session.session_cm_id)}>
                {optionLabel(session)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute right-3 h-4 w-4"
      />
    </div>
  )
}
