/**
 * Shared dividers used between parent / staff / age-preference row sections in
 * BunkingStatusPanel and CamperDetailsPanel. Lives outside both panels so the
 * two views stay visually identical without two copies of the JSX drifting.
 */
import { ChevronDown, ChevronUp } from 'lucide-react'

// Single divider between parent and staff sections — labeled on both sides
// with directional chevrons so staff can read which group is above and which
// is below at a glance. Render only when BOTH groups have rows.
export function ParentStaffDivider() {
  return (
    <div className="text-muted-foreground/70 my-3 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] uppercase">
      <span className="border-border/60 flex-1 border-t" />
      <span className="inline-flex items-center gap-1">
        Parent <ChevronUp className="h-3 w-3" />
      </span>
      <span className="border-border/60 h-3 border-l" aria-hidden="true" />
      <span className="inline-flex items-center gap-1">
        <ChevronDown className="h-3 w-3" /> Staff
      </span>
      <span className="border-border/60 flex-1 border-t" />
    </div>
  )
}

// Subtle hairline above the age-preference tail section — no label, just a
// quiet visual break so age rows don't bleed into the staff/parent rows above.
export function AgePreferenceDivider() {
  return <div className="border-border/60 my-2 border-t" aria-hidden="true" />
}
