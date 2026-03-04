import { memo } from 'react'

interface BunkWarningsProps {
  isOverCapacity: boolean
  ageGapWarning: boolean
  gradeRatioWarning: boolean
  tooManyGradesWarning: boolean
  capacity: number
  isLocked?: boolean
}

export const BunkWarnings = memo(function BunkWarnings({
  isOverCapacity,
  ageGapWarning,
  gradeRatioWarning,
  tooManyGradesWarning,
  capacity,
  isLocked,
}: BunkWarningsProps) {
  const hasWarnings =
    (isOverCapacity || ageGapWarning || gradeRatioWarning || tooManyGradesWarning) && !isLocked

  if (!hasWarnings) return null

  return (
    <div className="mt-3 space-y-2">
      {isOverCapacity && (
        <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-xl border p-2.5 text-xs">
          <strong>Over Capacity:</strong> Bunk exceeds standard capacity of {capacity} campers
        </div>
      )}
      {ageGapWarning && (
        <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-xl border p-2.5 text-xs">
          <strong>Age Spread Warning:</strong> Age difference exceeds 24 months (2 years)
        </div>
      )}
      {gradeRatioWarning && (
        <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-xl border p-2.5 text-xs">
          <strong>Grade Ratio Warning:</strong> More than 67% of campers are from a single grade
        </div>
      )}
      {tooManyGradesWarning && (
        <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-xl border p-2.5 text-xs">
          <strong>Too Many Grades:</strong> Bunk has more than 2 different grades
        </div>
      )}
    </div>
  )
})
