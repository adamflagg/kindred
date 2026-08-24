/**
 * The "Push write-ins" entry point (kindred#2477) — the button that opens the
 * scenario→live review, and the modal it opens.
 *
 * Lives at the PAGE level, to the right of `WeekendStatsBar` in the sticky
 * header, not inside `LodgingBoard` — the owner's placement ruling on the
 * first visual pass (2026-08-24): a toolbar row of its own above the areas
 * pushed the whole board down for one button. The stats line already owns the
 * header's horizontal band; the entry shares it.
 *
 * Present only where a push could ever apply — inside a scenario, held by a
 * `bunking.manage` user, on a real weekend — and ABSENT everywhere else.
 * `opacity-40` is the board's vocabulary for a refusal (CLAUDE.md §4); an
 * affordance with nothing behind it is not a refusal, so it does not render.
 * `sessionCmId > 0` carries the same reason `canPlace` does: a board under
 * test defaults it to 0, and the preview endpoint requires a positive id.
 */
import { Send } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { LodgingUnitRow } from '../../types/lodging'
import { PushWriteInsModal } from './PushWriteInsModal'
import { drawnUnits } from './unitLevel'
import { coveringWriteIns } from './writeIn'

interface PushWriteInsEntryProps {
  year: number
  /** `0` is "no weekend selected" and hides the entry. */
  sessionCmId: number
  /** `''` is the CampMinder mirror — nothing to push, so nothing renders. */
  scenario: string
  canManage: boolean
  units: LodgingUnitRow[]
}

export function PushWriteInsEntry({
  year,
  sessionCmId,
  scenario,
  canManage,
  units,
}: PushWriteInsEntryProps) {
  const [open, setOpen] = useState(false)

  // Badge: board-wide count of write-in rows a push would compare. Summed
  // over DRAWN units (`drawnUnits`, the cards the board shows) — a write-in
  // surfaces on every unit its space resolves through (`own` on its holder,
  // `descendant` on a merged ancestor, `ancestor` on a split descendant), and
  // only one of those levels is drawn at a time, so counting `own` +
  // `descendant` while excluding `ancestor` counts each underlying row once.
  // Same arithmetic the board itself used when it hosted this button.
  const count = useMemo(() => {
    let total = 0
    for (const unit of drawnUnits(units)) {
      for (const cover of coveringWriteIns(unit)) {
        if ((cover.relation ?? 'own') !== 'ancestor') total += 1
      }
    }
    return total
  }, [units])

  if (scenario === '' || !canManage || sessionCmId <= 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        className="btn-secondary flex flex-shrink-0 items-center gap-1.5"
      >
        <Send className="h-4 w-4" />
        Push write-ins
        <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
          {count}
        </span>
      </button>
      <PushWriteInsModal
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
