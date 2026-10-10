import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import {
  PREVIEW_SETTLE_MS,
  useAidPlacePreview,
} from '../../../hooks/camperships/useAidPlacePreview'
import { useAidLeaveLine, useAidPlaceLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidPlacePreviewIn, ApiAidToPlaceLine } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import {
  CS_AMBER_NOTE,
  CS_BTN,
  CS_BTN2,
  CS_LINK_SM,
  CS_PANEL_RULE,
  CS_PHEAD,
  CS_POPEN_META,
} from '../kit/csType'
import { DefRef } from '../kit/DefinitionNotes'
import { formatMoney, toCents } from '../kit/money'
import { PlaceEditor } from './PlaceEditor'
import { ReasonEditor } from './ReasonEditor'
import { ReclassifyEditor } from './ReclassifyEditor'
import { toPlaceHref } from './moneyTabs'
import { inStaffWords, previewRefusalWords, refusalWords } from './refusal'
import {
  candidateDetail,
  candidateShort,
  candidateStatusWords,
  confirmBody,
  confirmLines,
  evidenceLines,
  historyWords,
  lineFamily,
  lineWordsBare,
  noSuggestionEffects,
  placeChoices,
  placedTitle,
  placedWords,
  requestLabels,
  stillNotPlacedWords,
  suggestionShort,
  suggestsSplit,
} from './toPlaceModel'
import { EffectList } from './ToPlaceParts'
import type { InFlightLines } from './useInFlightLines'
import type { ToPlaceMarks } from './useToPlaceNotes'

export interface LineAccess {
  /** `casework`: Confirm, Split…, Place on Another Request…, Leave (spec §3.2). */
  readonly casework: boolean
  /** `rules`: Reclassify (D104; part 1b). */
  readonly rules: boolean
}

type Mode = 'none' | 'leave' | 'split' | 'another' | 'reclassify'

/**
 * Three panels side by side, divided by the grid's dashed amber rule (the mock's `.cf-open`: 5 : 4 : 5 at 13.5px,
 * panels padded 14px with a 2px gap, the first flush left).
 */
const THREE_PANELS =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)] items-stretch text-[13.5px] leading-normal'
const LEFT = `flex min-w-0 flex-col gap-0.5 border-r pr-3.5 pl-0 ${CS_PANEL_RULE}`
const MIDDLE = `flex min-w-0 flex-col gap-0.5 border-r px-3.5 ${CS_PANEL_RULE}`
const RIGHT = 'flex min-w-0 flex-col gap-0.5 pl-3.5'

/** The suggestion's parts, as the preview route takes them (exact to the cent, P-4). */
function suggestionBody(line: ApiAidToPlaceLine): ApiAidPlacePreviewIn | null {
  const body = confirmBody(line)
  return body === null ? null : { parts: body.parts, note: '' }
}

/** A panel's head, with the footnote mark the registry numbers it (§12). */
function PanelHead({
  children,
  mark,
  later = false,
}: {
  children: string
  mark?: ToPlaceMarks[keyof ToPlaceMarks]
  /** A head after another in its panel sits 7px lower (the mock's `.cf-phead ~ .cf-phead`). */
  later?: boolean
}) {
  return (
    <p className={later ? `${CS_PHEAD} mt-[7px]` : CS_PHEAD}>
      {children}
      {mark !== null && mark !== undefined && <DefRef n={mark.n} title={mark.title} />}
    </p>
  )
}

/**
 * A To place line opened (owner ruling A, 10-06: "yes, the grid's 3-panel opened row"; final UX §16,
 * §24), in `AidTable`'s detail line: it wraps and stays put while the rows scroll sideways.
 * - Left: the line as CampMinder holds it ("· $X still not placed" where part is placed, ruling B),
 *   the suggestion and its evidence, one fact per line.
 * - Middle: the requests it could belong to, each with what it still lacks ("not yet in CampMinder").
 * - Right: what Confirm does before the click (§4.10), one effect per line with ✓ ○ ⚠ and →, the
 *   refusal if any, the buttons and links.
 * An editor (Split…, Place on Another Request…, Reclassify…, Leave) opened from a row takes the whole
 * opened row, under the three panels (§24).
 * For casework, a line that stays open `PREVIEW_SETTLE_MS` asks the server afresh what Confirm would
 * do (P-4); Confirm sends that answer's lock. Until it answers, and for view-only staff, the read's
 * own preview shows.
 */
export function ToPlaceOpenRow({
  line,
  year,
  view,
  scope = null,
  access,
  inFlight,
  marks,
  onDone,
  onRefused,
}: {
  line: ApiAidToPlaceLine
  year: number
  view: AidView
  /** The tab's one-family scope (`?household=`, P-8); null shows every family. */
  scope?: number | null | undefined
  access: LineAccess
  inFlight: InFlightLines
  marks: ToPlaceMarks
  onDone: (words: string, title?: string) => void
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
  const evidence = evidenceLines(line)
  const family = lineFamily(line).text
  const choices = placeChoices(line)
  // money-v2.html (review item 6): a split suggestion is confirmed as "Confirm Split" and edited
  // from "Edit the Split…"; any other line with two candidates offers "Split…".
  const splits = suggestsSplit(line)
  // A write from an editor finished: close the editor, and say what it did at the tab.
  const finish = (words: string, title?: string) => {
    setMode('none')
    onDone(words, title)
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
      onDone(
        placedWords(out, [line], () => family),
        placedTitle(out, [line], requestLabels([line]), () => family)
      )
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

  const [suggested] = line.suggestion?.parts ?? []
  const suggestedAt = (requestId: string) => {
    const c = line.candidates.find((x) => x.request_id === requestId)
    return c === undefined ? 'another request' : candidateShort(c, line)
  }

  // Split…, Place on Another Request…, Reclassify… and Leave open in the right panel, as the mock draws them
  // (owner Q13, 10-09): the opened row stays one block, with no empty third panel.
  const editing = mode !== 'none'
  const leaveEditor = (
    <ReasonEditor
      title={line.reason === 'several' ? 'Leave at family level' : 'Leave with a note'}
      label="Why"
      submitLabel="Leave It"
      hint="It leaves the open count · Reopen needs a reason"
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
            : `${family}: left at family level with your note · Reopen needs a reason`
        )
      }}
    />
  )
  const history = historyWords(line)

  return (
    <div className="flex flex-col gap-2 pl-[22px]" data-testid="to-place-row">
      <div className={THREE_PANELS}>
        <div className={LEFT} data-panel="line">
          <p className={CS_PHEAD}>The line in CampMinder</p>
          <p>
            <b>{formatMoney(line.amount)}</b> · {lineWordsBare(line)}
            {still !== null && <span className="text-muted-foreground"> {still}</span>}
          </p>
          {history !== null && <p className={CS_POPEN_META}>{history}</p>}
          <PanelHead mark={marks.suggestion} later>
            Suggestion
          </PanelHead>
          {line.suggestion === null ? (
            <p className={CS_POPEN_META}>{`${suggestionShort(line)}.`}</p>
          ) : line.suggestion.parts.length > 1 ? (
            <>
              <p>
                {/* What the parts add to: the server builds them over the whole line, so a partly
                    placed line's unplaced figure would understate them (scan #3117 A). */}
                <b>{`Split ${formatMoney(line.suggestion.parts.reduce((sum, p) => sum + toCents(p.amount), 0) / 100)}`}</b>
              </p>
              {line.suggestion.parts.map((p) => (
                <p
                  key={p.request_id}
                >{`${formatMoney(p.amount)} → ${suggestedAt(p.request_id)}`}</p>
              ))}
            </>
          ) : (
            suggested !== undefined && (
              <p>
                <b>{`Place on ${suggestedAt(suggested.request_id)}`}</b>
              </p>
            )
          )}
          {evidence.map((fact) => (
            <p key={fact} className={CS_POPEN_META}>
              {fact}
            </p>
          ))}
        </div>
        <div className={MIDDLE} data-panel="candidates">
          <PanelHead mark={marks.candidates}>Requests it could belong to</PanelHead>
          {line.candidates.length === 0 ? (
            <p className={CS_POPEN_META}>No application this season.</p>
          ) : (
            <ul className="space-y-0.5">
              {line.candidates.map((c) => {
                const status = candidateStatusWords(c)
                return (
                  <li key={c.request_id}>
                    <span title={c.session}>{candidateShort(c, line)}</span>{' '}
                    <span className={CS_POPEN_META}>{`· ${candidateDetail(c)}`}</span>
                    {status !== '' && <div className={CS_POPEN_META}>{status}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className={RIGHT} data-panel="confirm">
          {!editing && (
            <>
              <PanelHead mark={marks.confirm}>What Confirm does</PanelHead>
              {line.suggestion === null ? (
                <EffectList lines={noSuggestionEffects(line)} />
              ) : previewRefused === null ? (
                <EffectList lines={confirmLines(line, would)} />
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
          {mode === 'leave' && leaveEditor}
          {mode === 'none' && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {/* R1-12: Confirm sends the suggestion; while an editor is open, its own button sends. */}
              {access.casework && body !== null && (
                <button
                  type="button"
                  className={CS_BTN}
                  disabled={place.isPending || busy}
                  onClick={() => void confirm()}
                >
                  {place.isPending || busy ? 'Placing…' : splits ? 'Confirm Split' : 'Confirm'}
                </button>
              )}
              {access.casework && choices.split && (
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={busy}
                  onClick={() => setMode('split')}
                >
                  {splits ? 'Edit the Split…' : 'Split…'}
                </button>
              )}
              {access.casework && choices.another && (
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={busy}
                  onClick={() => setMode('another')}
                >
                  Place on Another Request…
                </button>
              )}
              {access.rules && line.reason !== 'several' && (
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
              {!access.rules && access.casework && line.reason !== 'several' && (
                // money-v2.html draws it for the registrar, off, naming who can (R1-8b, coordinator
                // 10-08: follow the mock).
                <button type="button" className={CS_BTN2} disabled>
                  Reclassify… (finance)
                </button>
              )}
              {access.casework && (
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
                className={CS_LINK_SM}
              >
                Open the Household ›
              </Link>
              {scope === null && (
                <Link to={toPlaceHref(view, line.household_cm_id)} className={CS_LINK_SM}>
                  Only This Family ›
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
