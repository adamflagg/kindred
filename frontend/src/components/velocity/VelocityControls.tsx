import type { ReactNode } from 'react'

interface VelocityControlsProps {
  priorYearOptions: number[]
  selectedPriorYears: number[]
  splitByGender: boolean
  onTogglePriorYear: (year: number) => void
  onToggleGender: (enabled: boolean) => void
  extraControls?: ReactNode
}

export function VelocityControls({
  priorYearOptions,
  selectedPriorYears,
  splitByGender,
  onTogglePriorYear,
  onToggleGender,
  extraControls,
}: VelocityControlsProps) {
  return (
    <div className="card-lodge p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {priorYearOptions.length > 0 && (
          <div>
            <h3 className="text-foreground mb-2 text-sm font-medium">Compare with prior years</h3>
            <div className="flex flex-wrap gap-3">
              {priorYearOptions.slice(0, 5).map((year) => {
                const disabled =
                  splitByGender &&
                  !selectedPriorYears.includes(year) &&
                  selectedPriorYears.length >= 1
                return (
                  <label
                    key={year}
                    className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPriorYears.includes(year)}
                      onChange={() => onTogglePriorYear(year)}
                      disabled={disabled}
                      className="accent-primary h-4 w-4 rounded"
                      aria-label={String(year)}
                    />
                    <span className="text-foreground">{year}</span>
                  </label>
                )
              })}
            </div>
            {splitByGender && (
              <p className="text-muted-foreground mt-1 text-xs">
                Limited to 1 prior year when gender split is on
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-4">
          {extraControls}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={splitByGender}
              onChange={(e) => onToggleGender(e.target.checked)}
              className="accent-primary h-4 w-4 rounded"
              aria-label="Split by gender"
            />
            <span className="text-foreground">Split by gender</span>
          </label>
        </div>
      </div>
    </div>
  )
}
