import { useState } from 'react'
import { X, Calendar } from 'lucide-react'

interface SnapshotDateSelectorProps {
  snapshotDate: string | null
  onDateChange: (date: string) => void
  onClear: () => void
  availableDates: string[]
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function SnapshotDateSelector({
  snapshotDate,
  onDateChange,
  onClear,
  availableDates,
}: SnapshotDateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (!availableDates.length) return null

  // Inactive state — show "Snapshot..." button
  if (snapshotDate === null && !isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border border-dashed border-current/20 px-3 py-1.5 text-sm transition-colors"
      >
        <Calendar className="h-3.5 w-3.5" />
        Snapshot...
      </button>
    )
  }

  // Picker just opened — show dropdown
  if (snapshotDate === null && isOpen) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Calendar className="text-muted-foreground h-3.5 w-3.5" />
        <select
          autoFocus
          value=""
          onChange={(e) => {
            onDateChange(e.target.value)
            setIsOpen(false)
          }}
          onBlur={() => setIsOpen(false)}
          className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
        >
          <option value="" disabled>
            Select date
          </option>
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {formatDate(date)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // Active state — show selected date + clear button
  return (
    <div className="flex items-center gap-2 text-sm">
      <Calendar className="text-muted-foreground h-3.5 w-3.5" />
      <select
        value={snapshotDate ?? ''}
        onChange={(e) => onDateChange(e.target.value)}
        className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
      >
        {availableDates.map((date) => (
          <option key={date} value={date}>
            {formatDate(date)}
          </option>
        ))}
      </select>
      <button
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded p-1 transition-colors"
        aria-label="Clear snapshot date"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
