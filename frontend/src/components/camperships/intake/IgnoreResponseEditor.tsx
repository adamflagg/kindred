import { useId, useRef, useState } from 'react'

import { AidPicker } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FIELD, CS_POPEN_META } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { Effects } from '../kit/Effects'
import {
  ignoreBody,
  ignoreEffects,
  ignoreProblem,
  IGNORE_KINDS,
  type IgnoreDraft,
} from './adultFormModel'
import type { FormResponseView, IgnoreKind } from './adultFormTypes'

const KEYS = 'Enter saves · Esc cancels'

/**
 * Ignore… (adult aid form design §5; mock v2 steps 11–12): a response that is a test, a duplicate or junk leaves
 * Responses to link, with a reason, and is never matched again. The kit's white EditorForm in the opened row's cream
 * (an editor opened from a row takes the whole opened row). Ignore Response stays off, with the reason why, until a
 * reason is picked; Other needs words.
 */
export function IgnoreResponseEditor({
  response,
  year,
  onIgnore,
  onCancel,
}: {
  response: FormResponseView
  year: number
  /** The write; its refusal shows beside the buttons. */
  onIgnore: (body: { kind: IgnoreKind; reason: string }) => Promise<unknown>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<IgnoreDraft>({ kind: null, reason: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const reasonId = useId()
  const problem = ignoreProblem(draft)

  const set = (patch: Partial<IgnoreDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }
  const save = async () => {
    if (inFlight.current || problem !== null) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await onIgnore(ignoreBody(draft))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't ignore the response")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  const refusal = problem ?? error
  const effects = ignoreEffects(response).map((e) => ({
    sym: e.sym,
    text: (
      <>
        {e.lead !== '' && <b>{e.lead}</b>}
        {e.rest}
      </>
    ),
    then: e.then,
  }))

  return (
    <form
      data-aid-editor=""
      className="mt-2 max-w-[1100px]"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          if (!inFlight.current) onCancel()
        }
      }}
    >
      <EditorForm
        heading="phead"
        title={`Ignore a Response · “${response.name_typed}”`}
        side={<Effects items={effects} />}
        actions={
          <EditorActions>
            <button type="submit" className={CS_BTN} disabled={problem !== null || saving}>
              Ignore Response
            </button>
            <button type="button" className={CS_BTN2} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            {refusal !== null ? (
              <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={refusal}>
                {refusal}
              </span>
            ) : (
              <span className={CS_POPEN_META}>{KEYS}</span>
            )}
          </EditorActions>
        }
      >
        <EditorGrid>
          <EditorField label="Why" wide>
            <AidPicker<IgnoreKind | ''>
              label="Why"
              size="field"
              className="min-w-[230px]"
              value={draft.kind ?? ''}
              placeholder="Choose a reason"
              options={IGNORE_KINDS(year)}
              onChange={(value) => {
                if (value !== '') set({ kind: value })
              }}
            />
          </EditorField>
          <EditorField label="Reason" htmlFor={reasonId} wide>
            <input
              id={reasonId}
              aria-label="Reason"
              type="text"
              maxLength={2000}
              className={`${CS_FIELD} w-full`}
              placeholder="What staff should know: shown under All forms beside Ignored"
              value={draft.reason}
              onChange={(event) => set({ reason: event.target.value })}
            />
          </EditorField>
        </EditorGrid>
      </EditorForm>
    </form>
  )
}
