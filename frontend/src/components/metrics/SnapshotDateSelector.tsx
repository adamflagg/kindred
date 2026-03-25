import { Calendar } from 'lucide-react'
import type { WeekOption } from '../../types/forecast'

interface WeekSelectorProps {
  dayOffset: number | null
  onOffsetChange: (offset: number | null) => void
  weekOptions: WeekOption[]
}

/** Value used in the <select> for live/today mode. */
const TODAY_VALUE = '__today__'

export function SnapshotDateSelector({
  dayOffset,
  onOffsetChange,
  weekOptions,
}: WeekSelectorProps) {
  if (!weekOptions.length) return null

  // Find the today entry to use as the "live" option
  const todayOption = weekOptions.find((o) => o.is_today)
  const historicalOptions = weekOptions.filter((o) => !o.is_today)

  // Resolve the effective value: if dayOffset is null but no today option exists
  // (past season), fall back to the first historical option
  const effectiveValue =
    dayOffset == null
      ? todayOption
        ? TODAY_VALUE
        : historicalOptions[0]
          ? String(historicalOptions[0].day_offset)
          : TODAY_VALUE
      : String(dayOffset)

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Calendar className="text-muted-foreground h-3.5 w-3.5" />
      <select
        aria-label="Forecast week"
        value={effectiveValue}
        onChange={(e) => {
          const val = e.target.value
          onOffsetChange(val === TODAY_VALUE ? null : Number(val))
        }}
        className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
      >
        {todayOption && <option value={TODAY_VALUE}>{todayOption.label}</option>}
        {historicalOptions.map((opt) => (
          <option key={opt.day_offset} value={String(opt.day_offset)}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
