import { useState } from 'react'
import { Link } from 'react-router'

import { useAidLeaveLine, useAidPlaceLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { ReasonForm } from '../household/ReasonForm'
import { aidHref, type AidView } from '../kit/asOf'
import {
  candidateDetail,
  candidateLabel,
  confirmBody,
  confirmLines,
  isMarkLine,
  evidenceWords,
  lineWords,
  placedWords,
  requestLabels,
  suggestionWords,
  stillNotPlacedWords,
} from './toPlaceModel'
import { inStaffWords, refusalWords } from './refusal'
import type { InFlightLines } from './useInFlightLines'
import { PANEL_BLOCK, PANEL_LABEL, MARK_TEXT } from './toPlaceStyles'

export interface LinePanelAccess {
  /** `casework`: Confirm, Split, Place on another request, Leave (spec §3.2). */
  readonly casework: boolean
  /** `rules`: Reclassify (D104). */
  readonly rules: boolean
}

type Mode = 'none' | 'leave'

/**
 * The panel under a highlighted To place line (§8.1; money-v2.html): the line as CampMinder holds it,
 * the requests it could belong to with what each still lacks, the suggestion and its evidence,
 * and what Confirm will tick before the click (§4.10). Confirm sends what it showed it would lock; if
 * the season moved, the server refuses and the panel shows the new preview, never a stuck state.
 */
export function ToPlaceLinePanel({
  line,
  year,
  view,
  access,
  inFlight,
  onDone,
  onRefused,
}: {
  line: ApiAidToPlaceLine
  year: number
  view: AidView
  access: LinePanelAccess
  inFlight: InFlightLines
  onDone: (words: string) => void
  /** A refusal goes up to the tab: this panel unmounts when the refresh drops its line. */
  onRefused: (words: string) => void
}) {
  const place = useAidPlaceLine()
  const leave = useAidLeaveLine()
  const [mode, setMode] = useState<Mode>('none')
  const [error, setError] = useState<string | null>(null)
  const txn = line.transaction_cm_id
  const busy = inFlight.has(txn)
  const still = stillNotPlacedWords(line)
  const body = confirmBody(line)

  const confirm = async () => {
    // A second press while one is in flight is ignored (slice 1's ReasonForm pattern; plan review
    // m5): `isPending` from the render closure lags a fast double click, and a second POST would
    // come back "already placed" and paint an error over the success.
    if (body === null || !inFlight.begin(txn)) return
    setError(null)
    try {
      const out = await place.mutateAsync({
        year,
        transactionCmId: line.transaction_cm_id,
        body,
      })
      onDone(placedWords(out, [line], requestLabels([line])))
    } catch (caught) {
      // The reads refreshed before this rejection (onSettled is awaited): the preview above is
      // already the new one, so Confirm stays on and confirms what it now shows.
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.end(txn)
    }
  }

  return (
    <div className="space-y-3" data-testid="to-place-panel">
      <div className={PANEL_BLOCK}>
        <p className={PANEL_LABEL}>The line in CampMinder</p>
        <p>
          {lineWords(line)}
          {still !== null && <span className="text-muted-foreground"> {still}</span>}
        </p>
      </div>
      <div className={PANEL_BLOCK}>
        <p className={PANEL_LABEL}>Requests it could belong to</p>
        {line.candidates.length === 0 ? (
          <p className="text-muted-foreground">No application this season.</p>
        ) : (
          <ul>
            {line.candidates.map((c) => (
              <li key={c.request_id}>
                {candidateLabel(c)}{' '}
                <span className="text-muted-foreground text-xs">{candidateDetail(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={PANEL_BLOCK}>
        <p className={PANEL_LABEL}>Suggestion</p>
        <p>{suggestionWords(line)}</p>
        {evidenceWords(line) !== '' && (
          <p className="text-muted-foreground text-xs">{evidenceWords(line)}</p>
        )}
      </div>
      {line.suggestion !== null && (
        <div className={PANEL_BLOCK}>
          <p className={PANEL_LABEL}>What Confirm does</p>
          <ul>
            {confirmLines(line).map((words) => (
              <li key={words} className={isMarkLine(words) ? MARK_TEXT : undefined}>
                {words}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error !== null && <p className={AMBER_NOTE}>{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {access.casework && body !== null && (
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={place.isPending || busy}
            onClick={() => void confirm()}
          >
            {place.isPending || busy ? 'Placing…' : 'Confirm'}
          </button>
        )}
        {access.casework && mode === 'none' && (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => setMode('leave')}
          >
            {line.reason === 'several' ? 'Leave at Family Level…' : 'Leave With a Note…'}
          </button>
        )}
        <Link
          to={aidHref(`/aid/households/${String(line.household_cm_id)}`, view)}
          className="text-primary text-xs font-medium hover:underline"
        >
          Open the Household ›
        </Link>
      </div>
      {mode === 'leave' && (
        <ReasonForm
          label="Why"
          submitLabel="Leave It"
          onCancel={() => setMode('none')}
          onSubmit={async (note) => {
            // The form shows a thrown message itself, so this one is not also sent up.
            if (!inFlight.begin(txn)) {
              throw new Error(
                'Nothing was written: this line is still saving. Try again when it finishes.'
              )
            }
            let written: number
            try {
              ;({ written } = await inStaffWords(
                leave.mutateAsync({ year, transactionCmId: txn, note })
              ))
            } catch (caught) {
              if (caught instanceof Error) onRefused(caught.message)
              throw caught
            } finally {
              inFlight.end(txn)
            }
            onDone(
              written === 0
                ? `${line.family}: already left at family level with this note; nothing changed.`
                : `${line.family}: left at family level with your note. Reopen needs a reason.`
            )
          }}
        />
      )}
    </div>
  )
}
