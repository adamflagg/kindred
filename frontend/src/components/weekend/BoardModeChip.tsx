/**
 * The board's and map's "what am I looking at" chip.
 *
 * Both surfaces hardcoded an amber "CM — CampMinder mirror, read-only" span.
 * That was true while a scenario OVERLAID the mirror and no weekend surface
 * could select one; #1974 made a scenario REPLACE the mirror and #1967 gave
 * the page a picker, so a hardcoded chip now asserts the mirror while showing
 * a draft — the one claim on the surface a reader would trust absolutely.
 *
 * One component rather than two copies, because the two copies had already
 * drifted to different wrappers around identical text.
 */

export interface BoardModeChipProps {
  /** `''` is the CampMinder mirror; anything else is a draft. */
  scenario: string
}

export function BoardModeChip({ scenario }: BoardModeChipProps) {
  if (scenario === '') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        CM — CampMinder mirror, read-only
      </span>
    )
  }

  // Deliberately still says read-only: #1967 selects a scenario, it does not
  // make the board writable. Drag placement (#1985) is what earns dropping
  // that half, and it should drop it HERE rather than adding a third chip.
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      Draft — your plan, read-only
    </span>
  )
}
