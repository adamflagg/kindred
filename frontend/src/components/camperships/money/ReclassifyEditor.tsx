import { useState } from 'react'

import { useAidSources } from '../../../hooks/camperships/useAidSources'
import { useAidReclassifyLine } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { AidPicker } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FIELD } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import type { AidPickerOption } from '../kit/pickerWords'
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
  onDone: (words: string, title?: string) => void
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
          : `${family}: reclassified as ${chosen.description} · the next ledger sync applies it`
      )
    } catch (caught) {
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.end(txn)
    }
  }

  // The targets under their kind, so no label outgrows the popover (mock `TARGET_OPTS`).
  const options: Array<AidPickerOption<string>> = [
    {
      value: '',
      label: sources.isLoading ? 'Loading the sources…' : 'Pick a classified aid source',
    },
    ...targets
      .map((t) => ({
        value: t.description_key,
        label: targetWords(t),
        group: t.who_paid === 'the camp' ? 'Camp aid' : 'Outside money',
      }))
      .sort((a, b) => (a.group === b.group ? 0 : a.group === 'Outside money' ? -1 : 1)),
  ]

  return (
    <form
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
      <EditorForm
        title="Reclassify"
        actions={
          <EditorActions reason="It can move money in or out of the budget · the next ledger sync applies it · until then the line is listed apart">
            <button type="submit" className={CS_BTN} disabled={!ready}>
              {busy ? 'Reclassifying…' : 'Reclassify'}
            </button>
            <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
              Back
            </button>
            {sources.error !== null && sources.data === undefined && (
              <span className={CS_AMBER_NOTE}>
                The sources couldn&apos;t load: {sources.error.message}
              </span>
            )}
            {error !== null && <span className={CS_AMBER_NOTE}>{error}</span>}
          </EditorActions>
        }
      >
        <EditorGrid columns={4}>
          <EditorField label="Reclassify as">
            <AidPicker
              label="Reclassify as"
              size="field"
              value={target}
              options={options}
              onChange={setTarget}
              className="w-full [&>button]:w-full"
            />
          </EditorField>
          <EditorField label="Reason">
            <input
              type="text"
              aria-label="Reason"
              className={`${CS_FIELD} w-full`}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </EditorField>
        </EditorGrid>
      </EditorForm>
    </form>
  )
}
