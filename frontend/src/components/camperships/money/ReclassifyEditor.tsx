import { useState } from 'react'

import { useAidSources } from '../../../hooks/camperships/useAidSources'
import { useAidReclassifyLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { EditorBox } from '../household/ReasonForm'
import { HH_FIELD_TEXT, HH_FORM_LABEL, HH_FORM_ROW } from '../household/householdStyles'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_PMETA, CS_SELECT } from '../kit/csType'
import { refusalWords } from './refusal'
import { lineFamily, reclassifyTargets, targetWords } from './toPlaceModel'
import type { InFlightLines } from './useInFlightLines'

/** The server's limit on a reason (`_Reason`, 2000). */
const REASON_MAX = 2000

/**
 * Reclassify… (D104; P-7; `rules`, with a reason): the line's money is really another aid source's.
 * The next ledger sync applies it; until then the line is listed apart and can't be placed or left.
 * Targets come from the sources registry: classified aid sources, never the line's own description.
 */
export function ReclassifyEditor({
  line,
  year,
  inFlight,
  onCancel,
  onDone,
  onRefused,
}: {
  line: ApiAidToPlaceLine
  year: number
  inFlight: InFlightLines
  onCancel: () => void
  onDone: (words: string) => void
  /** A refusal goes up to the tab too: this row unmounts when the refresh drops its line. */
  onRefused: (words: string) => void
}) {
  const sources = useAidSources()
  const reclassify = useAidReclassifyLine()
  const txn = line.transaction_cm_id
  const busy = inFlight.has(txn)
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const targets = reclassifyTargets(sources.data?.sources ?? [], line)
  const chosen = targets.find((t) => t.description_key === target)
  const ready = chosen !== undefined && reason.trim() !== '' && !busy

  const send = async () => {
    if (chosen === undefined || reason.trim() === '' || !inFlight.begin(txn)) return
    setError(null)
    const family = lineFamily(line).text
    try {
      const out = await reclassify.mutateAsync({
        year,
        transactionCmId: txn,
        body: { source_key: chosen.description_key, reason: reason.trim() },
      })
      onDone(
        out.written === 0
          ? `${family}: already reclassified as ${chosen.description}; nothing changed.`
          : `${family}: reclassified as ${chosen.description}. The next ledger sync applies it; until then the line is listed apart.`
      )
    } catch (caught) {
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.end(txn)
    }
  }

  return (
    <EditorBox head="Reclassify">
      <form
        className="space-y-2"
        data-testid="reclassify-editor"
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
        <div className={HH_FORM_ROW}>
          <label className={HH_FORM_LABEL}>
            Reclassify as
            <select
              className={CS_SELECT}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">
                {sources.isLoading ? 'Loading the sources…' : '— pick a classified aid source —'}
              </option>
              {targets.map((t) => (
                <option key={t.id} value={t.description_key}>
                  {targetWords(t)}
                </option>
              ))}
            </select>
          </label>
          <label className={HH_FORM_LABEL}>
            Reason
            <input
              type="text"
              className={HH_FIELD_TEXT}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        <p className={CS_PMETA}>
          It can move money in or out of the budget. The next ledger sync applies it; until then the
          line is listed apart and can&apos;t be placed. A description reclassified again and again
          is fixed once in Money › Funders.
        </p>
        {sources.error !== null && sources.data === undefined && (
          <p className={CS_AMBER_NOTE}>The sources couldn&apos;t load: {sources.error.message}</p>
        )}
        {error !== null && <p className={CS_AMBER_NOTE}>{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={CS_BTN} disabled={!ready}>
            {busy ? 'Reclassifying…' : 'Reclassify'}
          </button>
          <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
            Back
          </button>
        </div>
      </form>
    </EditorBox>
  )
}
