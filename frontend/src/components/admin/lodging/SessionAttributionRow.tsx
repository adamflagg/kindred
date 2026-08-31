/**
 * One row of the cabin-weekend attribution queue (kindred#2648 UI half).
 *
 * Shared by the admin queue tab (the always-accessible home) and the board's
 * stats-bar chip modal — `useSessionAttributionQueue` fetches once, this
 * renders it twice. Style matches `UnresolvedAliasQueue.tsx` row-for-row:
 * `card-lodge flex flex-col gap-3 p-4`, mono raw value, an action row.
 *
 * ⛔ NO CHANGE-WEEKEND AFFORDANCE, DELIBERATELY. Confirming is one-time: the
 * backend materialises a NEW `lodging_assignments` row on the false -> true
 * `is_resolved` transition (`replayOnResolve`), not an update to whatever a
 * party's confirmed weekend used to be, so re-confirming a different weekend
 * would put a household in two cabins rather than moving it. Whether a
 * re-confirmation may ever delete a `staff_touched` row to make room is an
 * open owner decision (kindred#2648) — until it is ruled, this row offers no
 * "Undo" and no "Change weekend". A resolved row never reaches this
 * component anyway: `useSessionAttributionQueue` reads only
 * `is_resolved = false` rows, so once a confirm lands the row simply stops
 * being fetched.
 */
import { LABEL, MUTED_PILL, PILL } from './lodgingStyles'
import type { SessionAttributionQueueItem } from '../../../hooks/useSessionAttributionQueue'

const BUTTON_PRIMARY =
  'bg-primary text-primary-foreground shadow-lodge-sm inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50'
const BUTTON_SECONDARY =
  'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50'

export interface SessionAttributionRowProps {
  item: SessionAttributionQueueItem
  onConfirm: (sessionCmId: number) => void
  isConfirming: boolean
}

export function SessionAttributionRow({
  item,
  onConfirm,
  isConfirming,
}: SessionAttributionRowProps) {
  // Exactly one of the two ids is ever set, as everywhere else in this
  // ingest — see `lodging_confirmed_session.go`'s `forParty`.
  const partyLabel =
    item.householdCmId > 0
      ? `Household ${String(item.householdCmId)}`
      : `Person ${String(item.personCmId)}`

  return (
    <div className="card-lodge flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className={`${LABEL} mb-0.5`}>CampMinder says</p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-foreground font-mono text-sm font-semibold">{item.rawValue}</p>
            {item.isStale && (
              <span className={`bg-muted text-muted-foreground ${PILL}`}>outdated</span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {partyLabel} · seen {item.occurrences}× · last checked {item.lastSeen}
          </p>
        </div>
        <div className="text-right">
          <p className={`${LABEL} mb-0.5`}>Cabin</p>
          <p className="font-mono text-xs">
            {item.resolvedUnitNames.length > 0 ? (
              item.resolvedUnitNames.join(' + ')
            ) : (
              <span className="text-muted-foreground italic">not recognized yet</span>
            )}
          </p>
        </div>
      </div>

      {item.isStale && (
        <p className="rounded-xl border-2 border-slate-300 bg-slate-50 p-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
          Out of date — a more recent CampMinder sync no longer shows this value for {partyLabel}.
        </p>
      )}

      <div>
        <p className={LABEL}>
          Which weekend could this be? (only weekends this party is attending)
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {item.candidates.map((candidate) => (
            <div key={candidate.sessionCmId} className="border-border rounded-xl border p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{candidate.short}</p>
                {candidate.isSuggested && (
                  <span
                    className={`bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 ${PILL}`}
                  >
                    best guess
                  </span>
                )}
              </div>
              {candidate.dateRange !== '' && (
                <p className="text-muted-foreground text-xs">{candidate.dateRange}</p>
              )}
              <button
                type="button"
                disabled={isConfirming}
                onClick={() => {
                  onConfirm(candidate.sessionCmId)
                }}
                className={`${candidate.isSuggested ? BUTTON_PRIMARY : BUTTON_SECONDARY} mt-2 w-full justify-center`}
              >
                This is {candidate.short}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
         * No onClick — deliberately inert. "I don't know yet" is the honest
         * answer for a row with no evidence, and the queue already gives it
         * for free: leaving a row unconfirmed does nothing and keeps it here
         * until staff are ready. There is no dismiss write for a party-scoped
         * row that would not immediately bounce back — `replayOnResolve`
         * re-runs attribution on any resolve, finds the same two-or-more
         * candidates, and re-opens the row (see that hook's own doc comment).
         * This button exists so the option reads as offered, not missing.
         */}
        <button type="button" className={MUTED_PILL}>
          I don&rsquo;t know yet
        </button>
      </div>
    </div>
  )
}
