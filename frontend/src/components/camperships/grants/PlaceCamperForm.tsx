import { useRef, useState } from 'react'

import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidPlaceGrants } from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { AidPicker } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_PANEL_HEAD, CS_PMETA } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import type { AidPickerOption } from '../kit/pickerWords'
import { refusalWords } from '../money/refusal'
import {
  evidenceLines,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  SUGGESTS_CONFIRMS,
} from './placeModel'

/**
 * Place a household-level grant line on a camper (spec §8.2; D16, D126; casework; final UX §24): the
 * household's candidates in the white picker, the suggestion pre-picked, what it does beside it, the
 * buttons on one row. A grant placement overwrites rather than refuses, so it reads the line again just
 * before sending (P-9) and sends nothing if someone placed it meanwhile.
 */
export function PlaceCamperForm({
  need,
  year,
  onCancel,
  onDone,
}: {
  need: ApiAidNeedsCamper
  year: number
  onCancel: () => void
  onDone: (words: string) => void
}) {
  const place = useAidPlaceGrants()
  const fresh = useFreshAidGrants()
  const [only] = need.candidates
  const [person, setPerson] = useState(() =>
    need.suggestion !== null
      ? String(need.suggestion.person_cm_id)
      : need.candidates.length === 1 && only !== undefined
        ? String(only.person_cm_id)
        : ''
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const submit = async () => {
    if (inFlight.current) return
    if (person === '') {
      setProblem('Pick the camper')
      return
    }
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    try {
      if (!stillNeedsCamper(await fresh(), need.grant.transaction_cm_id)) {
        setProblem(
          'This line has its camper now: someone placed it since the page loaded. Nothing was written.'
        )
        return
      }
      const out = await place.mutateAsync({
        year,
        body: { placements: [placementFor(need, Number(person))], note: '' },
      })
      onDone(placedGrantWords(out))
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const options: Array<AidPickerOption<string>> = [
    { value: '', label: 'Pick the camper' },
    ...need.candidates.map((c) => ({
      value: String(c.person_cm_id),
      label: need.suggestion?.person_cm_id === c.person_cm_id ? `${c.name} (suggested)` : c.name,
    })),
  ]

  return (
    <div data-aid-editor="" data-testid="place-camper-form">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !inFlight.current) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <EditorForm
          title="Put it on another camper"
          side={
            <div className="space-y-1">
              <p className={CS_PANEL_HEAD}>What it does</p>
              <p className={CS_PMETA}>
                It prices the camper’s unposted rounds with the grant; a posted amount stands.
              </p>
              {/* The facts behind the suggestion (the household page has no panel that says them); none with no suggestion. */}
              {evidenceLines(need).map((fact) => (
                <p key={fact} className={CS_PMETA}>
                  {fact}
                </p>
              ))}
            </div>
          }
          actions={
            <EditorActions reason={`${SUGGESTS_CONFIRMS} One logged operation in History.`}>
              <button type="submit" className={CS_BTN} disabled={busy}>
                {busy ? 'Placing…' : 'Put It There'}
              </button>
              <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
                Back
              </button>
              {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
            </EditorActions>
          }
        >
          <EditorGrid columns={2}>
            <EditorField label="Camper">
              <AidPicker
                label="Camper"
                size="field"
                value={person}
                options={options}
                onChange={setPerson}
                className="w-full max-w-72 [&>button]:w-full"
              />
            </EditorField>
          </EditorGrid>
        </EditorForm>
      </form>
    </div>
  )
}
