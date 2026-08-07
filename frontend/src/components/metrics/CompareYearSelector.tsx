/**
 * CompareYearSelector - Toggle comparison mode with "Compare to" dropdown.
 *
 * Two states:
 * - Inactive (compareYear=null): Shows "Compare to..." button
 * - Active (compareYear set): Shows "{primaryYear} vs {compareYear}" dropdown + X clear button
 */

import { useState } from 'react'
import { X, GitCompareArrows } from 'lucide-react'

interface CompareYearSelectorProps {
  primaryYear: number
  compareYear: number | null
  onCompareYearChange: (year: number) => void
  onClear?: () => void
  availableYears: number[]
}

export function CompareYearSelector({
  primaryYear,
  compareYear,
  onCompareYearChange,
  onClear,
  availableYears,
}: CompareYearSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Filter out the primary year from comparison options
  const comparisonYears = availableYears.filter((y) => y !== primaryYear)

  // Inactive state — show "Compare to..." button
  if (compareYear === null && !isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border border-dashed border-current/20 px-3 py-1.5 text-sm transition-colors"
      >
        <GitCompareArrows className="h-3.5 w-3.5" />
        Compare to...
      </button>
    )
  }

  // Picker just opened — show dropdown for initial selection
  if (compareYear === null && isOpen) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-foreground font-semibold">{primaryYear}</span>
        <span className="text-muted-foreground">vs</span>
        {/* This select replaces the "Compare to..." button the user just
            activated, so focus should move here the same way it would into
            a newly opened menu; without it a keyboard user who just pressed
            the button lands nowhere. */}
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus -- deliberate, see comment above
          autoFocus
          value=""
          onChange={(e) => {
            onCompareYearChange(Number(e.target.value))
            setIsOpen(false)
          }}
          onBlur={() => setIsOpen(false)}
          className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
        >
          <option value="" disabled>
            Select year
          </option>
          {comparisonYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // Active state — show year selector + clear button
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-foreground font-semibold">{primaryYear}</span>
      <span className="text-muted-foreground">vs</span>
      <select
        value={compareYear ?? ''}
        onChange={(e) => onCompareYearChange(Number(e.target.value))}
        className="border-border bg-background text-foreground focus:ring-primary rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
      >
        {comparisonYears.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      {onClear && (
        <button
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded p-1 transition-colors"
          aria-label="Clear comparison"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
