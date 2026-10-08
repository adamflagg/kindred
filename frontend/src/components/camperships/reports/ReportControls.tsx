import type { AidRequestSet } from '../../../services/camperships/aidApi'
import { CONTROL_BAR, DECIDED_INK, REPORT_NOTE } from '../kit/reportStyles'

const LINK_BUTTON = 'text-primary text-xs font-medium hover:underline'

/**
 * The reporting controls (spec §9.2; D129, D130, D138; statistics-v2.html; S4-3): view settings, off
 * by default, that never change a record. "Through the Round 1 deadline" and "Received through
 * <date>" are one choice (the URL's `through`), so they can't both be on; "Include not yet offered"
 * (Statistics only) adds decided amounts beside Posted. `asOfWords` names the figures' day.
 */
export function ReportControls({
  requestSet,
  onRequestSet,
  decided,
  onDecided,
  showDeadline = true,
  asOfWords,
}: {
  requestSet: AidRequestSet
  onRequestSet: (next: AidRequestSet) => void
  decided?: boolean | undefined
  onDecided?: ((next: boolean) => void) | undefined
  /** False on Year over year, where the deadline is the cutoff already. */
  showDeadline?: boolean | undefined
  asOfWords?: string | null | undefined
}) {
  const date = requestSet.kind === 'date' ? requestSet.date : ''
  return (
    <div className={CONTROL_BAR}>
      <span className="text-muted-foreground text-xs font-semibold">
        Reporting controls (off by default; they never change a record)
      </span>
      {showDeadline && (
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={requestSet.kind === 'deadline'}
            onChange={(event) =>
              onRequestSet(event.target.checked ? { kind: 'deadline' } : { kind: 'all' })
            }
          />
          Through the Round 1 deadline
        </label>
      )}
      <label className="flex items-center gap-1.5">
        Received through
        <input
          type="date"
          aria-label="Received through"
          className="bg-background border-border rounded border px-1.5 py-0.5 text-sm"
          value={date}
          disabled={requestSet.kind === 'deadline'}
          onChange={(event) => {
            const next = event.target.value
            onRequestSet(next === '' ? { kind: 'all' } : { kind: 'date', date: next })
          }}
        />
        {date !== '' && (
          <button
            type="button"
            className={LINK_BUTTON}
            onClick={() => onRequestSet({ kind: 'all' })}
          >
            Clear
          </button>
        )}
      </label>
      {onDecided !== undefined && (
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={decided === true}
            onChange={(event) => onDecided(event.target.checked)}
          />
          <span className={decided === true ? DECIDED_INK : undefined}>
            Include not yet offered
          </span>
        </label>
      )}
      {asOfWords ? <span className={`${REPORT_NOTE} ml-auto`}>{asOfWords}</span> : null}
    </div>
  )
}
