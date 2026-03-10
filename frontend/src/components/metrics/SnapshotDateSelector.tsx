import { Calendar } from 'lucide-react'

interface SnapshotDateSelectorProps {
  snapshotDate: string | null
  onDateChange: (date: string | null) => void
  availableDates: string[]
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** Value used in the <select> for live/today mode. */
const TODAY_VALUE = '__today__'

export function SnapshotDateSelector({
  snapshotDate,
  onDateChange,
  availableDates,
}: SnapshotDateSelectorProps) {
  if (!availableDates.length) return null

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Calendar className="text-muted-foreground h-3.5 w-3.5" />
      <select
        value={snapshotDate ?? TODAY_VALUE}
        onChange={(e) => {
          const val = e.target.value
          onDateChange(val === TODAY_VALUE ? null : val)
        }}
        className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
      >
        <option value={TODAY_VALUE}>Today</option>
        {availableDates.map((date) => (
          <option key={date} value={date}>
            {formatDate(date)}
          </option>
        ))}
      </select>
    </div>
  )
}
