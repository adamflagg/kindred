import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import {
  PREVIEW_SETTLE_MS,
  useAidPlacePreview,
} from '../../../hooks/camperships/useAidPlacePreview'
import { useAidLeaveLine, useAidPlaceLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidPlacePreviewIn, ApiAidToPlaceLine } from '../../../types/api-types'
import { ReasonForm } from '../household/ReasonForm'
import { aidHref, type AidView } from '../kit/asOf'
import {
  CS_AMBER_NOTE,
  CS_BTN,
  CS_BTN2,
  CS_LINK,
  CS_PANEL_HEAD,
  CS_PANEL_RULE,
  CS_PMETA,
} from '../kit/csType'
import { PlaceEditor } from './PlaceEditor'
import { ReclassifyEditor } from './ReclassifyEditor'
import { inStaffWords, previewRefusalWords, refusalWords } from './refusal'
import {
  candidateDetail,
  candidateLabel,
  confirmBody,
  confirmLines,
  evidenceWords,
  isMarkLine,
  lineFamily,
  lineWords,
  placeChoices,
  placedWords,
  requestLabels,
  stillNotPlacedWords,
  suggestionWords,
  suggestsSplit,
} from './toPlaceModel'
import { MARK_TEXT } from './toPlaceStyles'
import type { InFlightLines } from './useInFlightLines'

export interface LineAccess {
  /** `casework`: Confirm, Split…, Place on Another Request…, Leave (spec §3.2). */
  readonly casework: boolean
  /** `rules`: Reclassify (D104; part 1b). */
  readonly rules: boolean
}

type Mode = 'none' | 'leave' | 'split' | 'another' | 'reclassify'

/** Three panels side by side, divided by the grid's dashed amber rule (RequestDetailLine's grammar). */
const THREE_PANELS =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)] items-stretch text-sm'
const LEFT = `flex min-w-0 flex-col gap-1.5 border-r pr-4 ${CS_PANEL_RULE}`
const MIDDLE = `flex min-w-0 flex-col gap-1.5 border-r px-4 ${CS_PANEL_RULE}`
const RIGHT = 'flex min-w-0 flex-col gap-1.5 pl-4'

/** The suggestion's parts, as the preview route takes them (exact to the cent, P-4). */
function suggestionBody(line: ApiAidToPlaceLine): ApiAidPlacePreviewIn | null {
  const body = confirmBody(line)
  return body === null ? null : { parts: body.parts, note: '' }
}

/**
 * A To place line opened (owner ruling A, 10-06: "yes, the grid's 3-panel opened row"), in
 * `AidTable`'s detail line: it wraps and stays put while the rows scroll sideways.
 * - Left: the line as CampMinder holds it ("· $X still not placed" where part is placed, ruling B),
 *   the suggestion and its evidence.
 * - Middle: the requests it could belong to, each with what it still lacks ("not yet in CampMinder").
 * - Right: what Confirm does before the click (§4.10), the refusal if any, the buttons and links.
 * For casework, a line that stays open `PREVIEW_SETTLE_MS` asks the server afresh what Confirm would
 * do (P-4); Confirm sends that answer's lock. Until it answers, and for view-only staff, the read's
 * own preview shows.
 */
export function ToPlaceOpenRow({
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
  access: LineAccess
  inFlight: InFlightLines
  onDone: (words: string) => void
  /** A refusal goes up to the tab: this row unmounts when the refresh drops its line. */
  onRefused: (words: string) => void
}) {
  const place = useAidPlaceLine()
  const leave = useAidLeaveLine()
  const [mode, setMode] = useState<Mode>('none')
  const [error, setError] = useState<string | null>(null)
  const txn = line.transaction_cm_id
  const busy = inFlight.has(txn)
  const still = stillNotPlacedWords(line)
  const evidence = evidenceWords(line)
  const family = lineFamily(line).text
  const choices = placeChoices(line)
  // money-v2.html (review item 6): a split suggestion is confirmed as "Confirm Split" and edited
  // from "Edit the Split…"; any other line with two candidates offers "Split…".
  const splits = suggestsSplit(line)
  // A write from an editor finished: close the editor, and say what it did at the tab.
  const finish = (words: string) => {
    setMode('none')
    onDone(words)
  }
  // R1-2: ask only once the line has stayed open a moment. ↑/↓ opens each row it passes, and every
  // preview is a season read; a line passed over asks nothing. (Keyed by the line, so no reset.)
  const [settledOn, setSettledOn] = useState<number | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setSettledOn(txn), PREVIEW_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [txn])
  const settled = settledOn === txn
  const asked = useMemo(
    () => (access.casework && settled ? suggestionBody(line) : null),
    [access, line, settled]
  )
  const preview = useAidPlacePreview(year, txn, asked)
  // A refused preview means Confirm would be refused too: say why, and offer no Confirm.
  const previewRefused = previewRefusalWords(preview.error)
  const would = preview.data ?? line.suggestion
  const body = previewRefused === null ? confirmBody(line, would) : null

  const confirm = async () => {
    // A second press while one is in flight is ignored (ReasonForm's pattern): `isPending` from the
    // render closure lags a fast double click, and a second POST would come back "already placed".
    if (body === null || !inFlight.begin(txn)) return
    setError(null)
    try {
      const out = await place.mutateAsync({ year, transactionCmId: txn, body })
      onDone(placedWords(out, [line], requestLabels([line]), () => family))
    } catch (caught) {
      // The reads (and this preview) refreshed before this rejection: "What Confirm does" already
      // shows the new answer, so Confirm stays on and confirms what it now shows.
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.end(txn)
    }
  }

  return (
    <div className={THREE_PANELS} data-testid="to-place-row">
      <div className={LEFT} data-panel="line">
        <p className={CS_PANEL_HEAD}>The line in CampMinder</p>
        <p>
          {lineWords(line)}
          {still !== null && <span className="text-muted-foreground"> {still}</span>}
        </p>
        <p className={CS_PANEL_HEAD}>Suggestion</p>
        <p>{suggestionWords(line)}</p>
        {evidence !== '' && <p className={CS_PMETA}>{evidence}</p>}
      </div>
      <div className={MIDDLE} data-panel="candidates">
        <p className={CS_PANEL_HEAD}>Requests it could belong to</p>
        {line.candidates.length === 0 ? (
          <p className="text-muted-foreground">No application this season.</p>
        ) : (
          <ul className="space-y-0.5">
            {line.candidates.map((c) => (
              <li key={c.request_id}>
                {candidateLabel(c)} <span className={CS_PMETA}>{candidateDetail(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={RIGHT} data-panel="confirm">
        {line.suggestion !== null && (
          <>
            <p className={CS_PANEL_HEAD}>What Confirm does</p>
            {previewRefused === null ? (
              <ul className="space-y-0.5">
                {confirmLines(line, would).map((words) => (
                  <li key={words} className={isMarkLine(words) ? MARK_TEXT : undefined}>
                    {words}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className={CS_AMBER_NOTE}>{previewRefused}</p>
                {/* R1-14: a refusal can be a passing race ("Someone else changed this"); ask again. */}
                <button
                  type="button"
                  className={`${CS_BTN2} self-start`}
                  disabled={preview.isFetching}
                  onClick={() => void preview.refetch()}
                >
                  Try Again
                </button>
              </>
            )}
          </>
        )}
        {error !== null && <p className={CS_AMBER_NOTE}>{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* R1-12: Confirm sends the suggestion; while an editor is open, its own button sends. */}
          {access.casework && mode === 'none' && body !== null && (
            <button
              type="button"
              className={CS_BTN}
              disabled={place.isPending || busy}
              onClick={() => void confirm()}
            >
              {place.isPending || busy ? 'Placing…' : splits ? 'Confirm Split' : 'Confirm'}
            </button>
          )}
          {access.casework && mode === 'none' && choices.split && (
            <button
              type="button"
              className={CS_BTN2}
              disabled={busy}
              onClick={() => setMode('split')}
            >
              {splits ? 'Edit the Split…' : 'Split…'}
            </button>
          )}
          {access.casework && mode === 'none' && choices.another && (
            <button
              type="button"
              className={CS_BTN2}
              disabled={busy}
              onClick={() => setMode('another')}
            >
              Place on Another Request…
            </button>
          )}
          {access.rules && mode === 'none' && line.reason !== 'several' && (
            // P-7 (old Decision 7): finance, on a line no request explains or whose description
            // names another program; a several-requests line is placed, not reclassified.
            <button
              type="button"
              className={CS_BTN2}
              disabled={busy}
              onClick={() => setMode('reclassify')}
            >
              Reclassify…
            </button>
          )}
          {!access.rules && access.casework && mode === 'none' && line.reason !== 'several' && (
            // money-v2.html draws it for the registrar, off, naming who can (R1-8b, coordinator
            // 10-08: follow the mock).
            <button type="button" className={CS_BTN2} disabled>
              Reclassify… (finance)
            </button>
          )}
          {access.casework && mode === 'none' && (
            <button
              type="button"
              className={CS_BTN2}
              disabled={busy}
              onClick={() => setMode('leave')}
            >
              {line.reason === 'several' ? 'Leave at Family Level…' : 'Leave With a Note…'}
            </button>
          )}
          <Link
            to={aidHref(`/aid/households/${String(line.household_cm_id)}`, view)}
            className={`${CS_LINK} text-xs`}
          >
            Open the Household ›
          </Link>
        </div>
        {(mode === 'split' || mode === 'another') && (
          // The editor's own keys (Enter, Esc, ↑/↓ in its fields) stay its own: AidTable stands aside.
          <div data-aid-editor="">
            <PlaceEditor
              key={mode}
              line={line}
              year={year}
              mode={mode}
              inFlight={inFlight}
              onCancel={() => setMode('none')}
              onDone={finish}
              onRefused={onRefused}
            />
          </div>
        )}
        {mode === 'reclassify' && (
          <div data-aid-editor="">
            <ReclassifyEditor
              line={line}
              year={year}
              inFlight={inFlight}
              onCancel={() => setMode('none')}
              onDone={finish}
              onRefused={onRefused}
            />
          </div>
        )}
        {mode === 'leave' && (
          // The form's own keys (Enter, Esc) stay its own: AidTable stands aside inside it.
          <div data-aid-editor="">
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
                    ? `${family}: already left at family level with this note; nothing changed.`
                    : `${family}: left at family level with your note. Reopen needs a reason.`
                )
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
