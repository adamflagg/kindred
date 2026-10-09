import { useEffect, useRef, useState } from 'react'

import {
  partsKey,
  PREVIEW_SETTLE_MS,
  useAidPlacePreview,
} from '../../../hooks/camperships/useAidPlacePreview'
import { useAidPlaceLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type {
  ApiAidPlaceLineIn,
  ApiAidPlacePreviewIn,
  ApiAidToPlaceLine,
} from '../../../types/api-types'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FIELD, CS_PANEL_HEAD, CS_PMETA } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { formatMoney } from '../kit/money'
import { previewRefusalWords, refusalWords } from './refusal'
import { initialInputs, readSplit, wholeLineOn, type SplitInputs } from './splitModel'
import {
  candidateDetail,
  candidateLabel,
  candidateShort,
  confirmEffects,
  exactAmount,
  lineFamily,
  placedTitle,
  placedWords,
  requestLabels,
} from './toPlaceModel'
import { EffectList } from './ToPlaceParts'
import type { InFlightLines } from './useInFlightLines'

/**
 * About one season read per ask (as the request editor's preview), so typing pauses before it asks:
 * the same pause the opened row waits before its own ask (R1-2).
 */
const DEBOUNCE_MS = PREVIEW_SETTLE_MS

/** The preview route takes the parts and the note the write would send (`PlacePreviewIn`). */
const previewOf = (body: ApiAidPlaceLineIn): ApiAidPlacePreviewIn => ({
  parts: body.parts,
  note: body.note ?? '',
})

/**
 * Split… (amounts across the line's candidates) or Place on Another Request… (the whole line on one
 * of them), §8.1 and D12, in the opened row's right panel. One logged operation; each part lands on
 * its request in full or nothing is written.
 *
 * P-4 (review item 19): as the parts are typed (after a pause) or a request is picked, the editor
 * asks the placement preview for exactly those parts and shows "What placing this does". The place
 * button sends that answer's `would_lock` as `expected_locked`, and is on only once the preview has
 * answered for the parts now typed: what you place is what you were shown (§4.10). A refused
 * preview says why; a preview that fails (a 5xx, a dropped connection) can be asked again.
 */
export function PlaceEditor({
  line,
  year,
  mode,
  inFlight,
  onCancel,
  onDone,
  onRefused,
}: {
  line: ApiAidToPlaceLine
  year: number
  mode: 'split' | 'another'
  inFlight: InFlightLines
  onCancel: () => void
  onDone: (words: string, title?: string) => void
  /** A refusal goes up to the tab too: this row unmounts when the refresh drops its line. */
  onRefused: (words: string) => void
}) {
  const place = useAidPlaceLine()
  const txn = line.transaction_cm_id
  const busy = inFlight.has(txn)
  const family = lineFamily(line).text
  const [inputs, setInputs] = useState<SplitInputs>(() => initialInputs(line))
  const [chosen, setChosen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What the preview was last asked. Split… opens on the suggestion's parts and asks at once.
  const [asked, setAsked] = useState<ApiAidPlacePreviewIn | null>(() => {
    if (mode !== 'split') return null
    const first = readSplit(line, initialInputs(line))
    return first.ok ? previewOf(first.body) : null
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  const ask = (body: ApiAidPlaceLineIn | null, wait: number) => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    // Parts that don't add up are never asked. The last answer stays, unused, until the parts on
    // screen are exactly the ones it answered for (`current` below).
    if (body === null) return
    if (wait === 0) {
      setAsked(previewOf(body))
      return
    }
    timer.current = setTimeout(() => setAsked(previewOf(body)), wait)
  }

  const split = readSplit(line, inputs)
  const typed =
    mode === 'split'
      ? split.ok
        ? split.body
        : null
      : chosen === null
        ? null
        : wholeLineOn(line, chosen)
  const preview = useAidPlacePreview(year, txn, asked)
  // The preview speaks for the parts now typed only once it was asked for exactly them.
  const current = typed !== null && asked !== null && partsKey(asked) === partsKey(previewOf(typed))
  const refused = current
    ? previewRefusalWords(preview.error, "This can't be placed as typed")
    : null
  const answer = current && preview.isSuccess ? preview.data : null
  const body: ApiAidPlaceLineIn | null =
    typed !== null && answer !== null && refused === null
      ? { ...typed, expected_locked: exactAmount(answer.would_lock ?? 0) }
      : null

  const send = async () => {
    // A second press while one is in flight is ignored (the tab's in-flight set, shared with Confirm).
    if (body === null || !inFlight.begin(txn)) return
    setError(null)
    try {
      const out = await place.mutateAsync({ year, transactionCmId: txn, body })
      onDone(
        placedWords(out, [line], () => family),
        placedTitle(out, [line], requestLabels([line]), () => family)
      )
    } catch (caught) {
      // The reads (and this preview) refreshed before the rejection: what placing does now shows,
      // and the button places what it now shows.
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.end(txn)
    }
  }

  const head =
    mode === 'split'
      ? `Split ${formatMoney(line.amount)}`
      : `Place all ${formatMoney(line.amount)} on one request`
  // The dependent choice, in the right column and always on screen: switched off, not hidden, until
  // there is something to preview (§24).
  const side = (
    <div className="space-y-1" data-testid="place-effects">
      <p className={CS_PANEL_HEAD}>What placing this does</p>
      {typed === null ? (
        <p className={`${CS_PMETA} opacity-60`}>
          {mode === 'split'
            ? 'Type parts that make the whole line to see it'
            : 'Pick a request to see it'}
        </p>
      ) : refused !== null ? (
        <p className={CS_AMBER_NOTE}>{refused}</p>
      ) : answer !== null ? (
        <EffectList lines={confirmEffects(line, answer)} />
      ) : current && preview.isError ? (
        <p className={CS_AMBER_NOTE}>
          {`Couldn't work out what placing this does: ${preview.error.message} `}
          <button type="button" className={CS_BTN2} onClick={() => void preview.refetch()}>
            Try Again
          </button>
        </p>
      ) : (
        <p className={CS_PMETA}>Working out what placing this does…</p>
      )}
    </div>
  )
  return (
    <form
      data-testid="place-editor"
      className="text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (!busy) onCancel()
        }
      }}
    >
      <EditorForm
        title={head}
        side={side}
        actions={
          <EditorActions reason="Each part lands on its request in full, or nothing is written · one logged operation">
            <button
              type="submit"
              className={CS_BTN}
              disabled={body === null || place.isPending || busy}
            >
              {place.isPending || busy
                ? 'Placing…'
                : mode === 'split'
                  ? 'Place the Split'
                  : 'Place It'}
            </button>
            <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
              Back
            </button>
            {error !== null && <span className={CS_AMBER_NOTE}>{error}</span>}
          </EditorActions>
        }
      >
        {mode === 'split' ? (
          <>
            <EditorGrid columns={2}>
              {line.candidates.map((c) => (
                <EditorField key={c.request_id} label={candidateShort(c, line)}>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Part for ${candidateLabel(c)}`}
                    title={`${candidateLabel(c)} · ${candidateDetail(c)}`}
                    className={`${CS_FIELD} w-32 text-right tabular-nums`}
                    value={inputs[c.request_id] ?? ''}
                    onChange={(event) => {
                      const next = { ...inputs, [c.request_id]: event.target.value }
                      setInputs(next)
                      const read = readSplit(line, next)
                      ask(read.ok ? read.body : null, DEBOUNCE_MS)
                    }}
                  />
                </EditorField>
              ))}
            </EditorGrid>
            <p className={`${CS_PMETA} mt-1`}>
              {split.ok ? (
                <>
                  <span data-sym="" className="text-forest-700 dark:text-forest-300 mr-1 font-bold">
                    ✓
                  </span>
                  {split.words}
                </>
              ) : (
                <>
                  <span data-sym="" className="mr-1 font-bold text-amber-700 dark:text-amber-300">
                    ⚠
                  </span>
                  {split.problem}
                </>
              )}
            </p>
          </>
        ) : (
          <ul className="space-y-1">
            {line.candidates.map((c) => (
              <li key={c.request_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`another-${String(txn)}`}
                    checked={chosen === c.request_id}
                    onChange={() => {
                      setChosen(c.request_id)
                      ask(wholeLineOn(line, c.request_id), 0)
                    }}
                  />
                  <span>{candidateShort(c, line)}</span>
                </label>
                <span className={CS_PMETA}>{`· ${candidateDetail(c)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </EditorForm>
    </form>
  )
}
