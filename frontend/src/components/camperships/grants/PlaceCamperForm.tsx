import { useRef, useState } from 'react'

import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidPlaceGrants } from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { EditorBox, EditorColumns, FormActions } from '../household/ReasonForm'
import { HH_AMBER_NOTE, HH_EDITOR_LABEL } from '../household/householdStyles'
import { CS_PMETA, CS_SELECT } from '../kit/csType'
import { refusalWords } from '../money/refusal'
import {
  evidenceWords,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  SUGGESTS_CONFIRMS,
} from './placeModel'

/**
 * Place a household-level grant line on a camper (spec §8.2; D16, D126; casework): the household's
 * candidates, the suggestion pre-picked. A grant placement overwrites rather than refuses, so it reads
 * the line again just before sending (P-9) and sends nothing if someone placed it meanwhile.
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

  return (
    <div data-aid-editor="" data-testid="place-camper-form">
      <EditorBox head="Place on a camper" aside={SUGGESTS_CONFIRMS}>
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
          <EditorColumns
            side={
              <p>
                It prices the camper&apos;s unposted rounds with the grant; a posted amount stands.
                One operation in History.
              </p>
            }
          >
            <label className={HH_EDITOR_LABEL}>
              Camper
              <select
                aria-label="Camper"
                className={CS_SELECT}
                value={person}
                onChange={(event) => setPerson(event.target.value)}
              >
                <option value="">— pick —</option>
                {need.candidates.map((c) => (
                  <option key={c.person_cm_id} value={String(c.person_cm_id)}>
                    {need.suggestion?.person_cm_id === c.person_cm_id
                      ? `${c.name} (suggested)`
                      : c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className={CS_PMETA}>{evidenceWords(need)}</p>
          </EditorColumns>
          <FormActions submitLabel={busy ? 'Placing…' : 'Place It'} busy={busy} onCancel={onCancel}>
            {problem !== null && <span className={HH_AMBER_NOTE}>{problem}</span>}
          </FormActions>
        </form>
      </EditorBox>
    </div>
  )
}
