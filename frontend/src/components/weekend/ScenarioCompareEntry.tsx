/**
 * The "Compare with CampMinder" entry point (kindred#2478 §5) — the button
 * that opens the scenario-vs-mirror report, and the modal it opens.
 *
 * Rides in the page header's action group beside "Push write-ins", where
 * summer's `SessionHeader` puts its own actions, for the reason that entry
 * documents.
 *
 * Present only where a comparison could ever mean anything, and ABSENT
 * everywhere else — `opacity-40` is the board's vocabulary for a REFUSAL
 * (CLAUDE.md §4), and an affordance with nothing behind it is not a refusal.
 * Four conditions:
 *
 *  * inside a scenario — the mirror cannot be compared against itself;
 *  * held by a `bunking.manage` user — the endpoint is gated exactly as
 *    `/push/preview` is, and for the same reason: it writes nothing, but
 *    reviewing a plan against CampMinder is part of the same staff workflow
 *    placing families is;
 *  * on a real weekend — `sessionCmId > 0`, since a board under test defaults
 *    it to 0 and the endpoint requires a positive id;
 *  * on a FAMILY CAMP weekend — owner ruling §5.1. The adult sessions are not
 *    in the bounded refresh cohort at all (`GetFamilyCampSessionCMIDs` filters
 *    `session_type = 'family'` exactly and only), so their mirror rows are
 *    rewritten daily from custom values up to seven days old. Comparing
 *    against them would grade a plan against data nobody refreshed. The
 *    endpoint refuses the same case with a 400; this hides the affordance so
 *    staff never reach it.
 */
import { GitCompare } from 'lucide-react'
import { useState } from 'react'

import { ScenarioCompareModal } from './ScenarioCompareModal'

interface ScenarioCompareEntryProps {
  year: number
  /** `0` is "no weekend selected" and hides the entry. */
  sessionCmId: number
  /** `''` is the CampMinder mirror — nothing to compare, so nothing renders. */
  scenario: string
  canManage: boolean
  /** `camp_sessions.session_type`. Only `'family'` renders (§5.1). */
  sessionType: string
}

export function ScenarioCompareEntry({
  year,
  sessionCmId,
  scenario,
  canManage,
  sessionType,
}: ScenarioCompareEntryProps) {
  const [open, setOpen] = useState(false)

  if (scenario === '' || !canManage || sessionCmId <= 0 || sessionType !== 'family') return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        // Summer's header-action string exactly (`SessionHeader`'s Clear
        // button), so the two surfaces' buttons are the same size and shape.
        // `flex-shrink-0` is the one addition: this header wraps where
        // summer's does not, and a squashed label is worse than a wrap.
        className="btn-secondary flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-sm"
      >
        <GitCompare className="h-4 w-4" />
        Compare with CampMinder
      </button>
      <ScenarioCompareModal
        year={year}
        sessionCmId={sessionCmId}
        scenario={scenario}
        isOpen={open}
        onClose={() => {
          setOpen(false)
        }}
      />
    </>
  )
}
