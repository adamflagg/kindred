/**
 * The "Push write-ins" entry point (kindred#2477) — the button that opens the
 * scenario→live review, and the modal it opens.
 *
 * Rendered through `WeekendStatsBar`'s `trailing` slot — INSIDE the bar's own
 * row, not beside it — per two owner rulings on the first visual pass
 * (2026-08-24). A toolbar row of its own above the areas pushed the whole
 * board down for one button; sitting beside the bar left the band's bottom
 * rule stopping short of the button. The bar owns the band, so the entry
 * lives in it.
 *
 * Present only where a push could ever apply — inside a scenario, held by a
 * `bunking.manage` user, on a real weekend — and ABSENT everywhere else.
 * `opacity-40` is the board's vocabulary for a refusal (CLAUDE.md §4); an
 * affordance with nothing behind it is not a refusal, so it does not render.
 * `sessionCmId > 0` carries the same reason `canPlace` does: a board under
 * test defaults it to 0, and the preview endpoint requires a positive id.
 *
 * ## The badge is the server's answer, not the board's own count
 *
 * It counts the rows a push would WRITE OR DELETE (`actionableRows`), not
 * the write-ins the board is carrying — owner ruling 2026-08-28. The two are
 * very different numbers on a weekend that has been pushed before: every
 * already-matching row used to inflate a badge staff read as work to do, and
 * the only way to disbelieve it was to open the modal and find four tiles
 * saying "Already matches: 12".
 *
 * Only the server can tell them apart. `/roster` replaces
 * `lodging_write_ins` with the scenario's draft rows for the duration of a
 * scenario, so a client inside one never reads the live board at all and has
 * nothing to diff against — hence `usePushPreview` here, sharing its cache
 * slot with the modal below rather than counting locally.
 *
 * ## Greyed, never disabled
 *
 * With nothing to push the button drops to `text-muted-foreground` and a
 * muted `0`, and stays clickable: the report is still worth reading, and a
 * dead button cannot say WHY there is nothing to do. An unknown count — the
 * preview still in flight, or failed — renders no badge and no grey, because
 * "we don't know yet" must not look like "nothing to do".
 */
import { Send } from 'lucide-react'
import { useState } from 'react'

import { usePushPreview } from '../../hooks/usePushPreview'
import { PushWriteInsModal } from './PushWriteInsModal'
import { actionableRows } from './pushCounts'

interface PushWriteInsEntryProps {
  year: number
  /** `0` is "no weekend selected" and hides the entry. */
  sessionCmId: number
  /** `''` is the CampMinder mirror — nothing to push, so nothing renders. */
  scenario: string
  canManage: boolean
}

export function PushWriteInsEntry({
  year,
  sessionCmId,
  scenario,
  canManage,
}: PushWriteInsEntryProps) {
  const [open, setOpen] = useState(false)
  const visible = scenario !== '' && canManage && sessionCmId > 0

  // Hooks run unconditionally; `enabled` is what stops a hidden entry from
  // asking the server anything.
  const preview = usePushPreview({ year, sessionCmId, scenario, enabled: visible })

  if (!visible) return null

  // `undefined` until a report lands — including after a failure, where the
  // modal is the place that explains itself.
  const count = preview.data === undefined ? undefined : actionableRows(preview.data.buildings)
  const nothingToPush = count === 0

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        // `px-4 py-2` overrides `btn-secondary`'s roomier `px-6 py-3` to match
        // summer's "Refresh Bunking" control (`AppLayout.tsx`), which is the
        // sizing the owner asked this to align with — and it has to sit inside
        // a `min-h-10` stats row without stretching it.
        className={`btn-secondary flex flex-shrink-0 items-center gap-1.5 px-4 py-2 ${
          nothingToPush ? 'text-muted-foreground' : ''
        }`}
      >
        <Send className="h-4 w-4" />
        Push write-ins
        {count !== undefined && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
              nothingToPush
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {count}
          </span>
        )}
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
