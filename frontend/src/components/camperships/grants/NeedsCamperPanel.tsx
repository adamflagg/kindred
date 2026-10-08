import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidPlaceGrants } from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
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
import { refusalWords } from '../money/refusal'
import { grantLineWords } from './needsModel'
import { PlaceCamperForm } from './PlaceCamperForm'
import {
  evidenceWords,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  suggestedWords,
  SUGGESTS_CONFIRMS,
} from './placeModel'

const THREE_PANELS =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)] items-stretch text-sm'
const PANEL = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const MIDDLE = `flex min-w-0 flex-col gap-1 border-r px-4 ${CS_PANEL_RULE}`
const LAST = 'flex min-w-0 flex-col gap-1.5 pl-4'

/**
 * A "needs a camper" line opened (owner ruling A; spec §8.2; D16, D126): left, the line in CampMinder;
 * middle, the suggestion and its evidence, and the household's campers; right, Confirm (the
 * suggestion, its session with it) and Another Camper… (casework). Each reads the line again just
 * before sending (P-9): a placement overwrites, so a line placed meanwhile is never re-placed.
 */
export function NeedsCamperPanel({
  need,
  year,
  view,
  names,
  canWork,
  onDone,
}: {
  need: ApiAidNeedsCamper
  year: number
  view: AidView
  names: Readonly<Record<string, string>>
  canWork: boolean
  onDone: (words: string) => void
}) {
  const place = useAidPlaceGrants()
  const fresh = useFreshAidGrants()
  const [another, setAnother] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const inFlight = useRef(false)
  const suggestion = need.suggestion

  const confirm = async () => {
    if (inFlight.current || suggestion === null) return
    inFlight.current = true
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
        body: { placements: [placementFor(need, suggestion.person_cm_id)], note: '' },
      })
      onDone(placedGrantWords(out))
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
    }
  }

  return (
    <div className="space-y-2" data-testid="needs-camper-panel">
      <div className={THREE_PANELS}>
        <div className={PANEL} data-panel="line">
          <div className={CS_PANEL_HEAD}>The grant line in CampMinder</div>
          <div>{grantLineWords(need)}</div>
          {need.grant.description !== '' && (
            <div className={CS_PMETA}>{need.grant.description}</div>
          )}
          <Link
            className={`${CS_LINK} text-xs`}
            to={aidHref(`/aid/households/${String(need.grant.household_cm_id)}`, view)}
          >
            Open the Household ›
          </Link>
        </div>
        <div className={MIDDLE} data-panel="suggestion">
          <div className={CS_PANEL_HEAD}>Suggestion</div>
          <div>{suggestedWords(need, names)}</div>
          <div className={CS_PMETA}>{evidenceWords(need)}</div>
          <div className={CS_PMETA}>
            {need.candidates.length === 0
              ? 'No camper in the household this season.'
              : `Campers in the household: ${need.candidates.map((c) => c.name).join(', ')}`}
          </div>
        </div>
        <div className={LAST} data-panel="actions">
          <div className={CS_PMETA}>{SUGGESTS_CONFIRMS}</div>
          {canWork && (
            <div className="flex flex-wrap gap-2">
              {suggestion !== null && (
                <button
                  type="button"
                  className={CS_BTN}
                  disabled={place.isPending || another}
                  onClick={() => void confirm()}
                >
                  {place.isPending ? 'Placing…' : 'Confirm'}
                </button>
              )}
              {need.candidates.length > 0 && (
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={another}
                  onClick={() => setAnother(true)}
                >
                  Another Camper…
                </button>
              )}
            </div>
          )}
          {canWork && (
            <div className={CS_PMETA}>
              It prices the camper&apos;s unposted rounds with the grant; a posted amount stands.
            </div>
          )}
          {problem !== null && <div className={CS_AMBER_NOTE}>{problem}</div>}
        </div>
      </div>
      {another && (
        <PlaceCamperForm
          need={need}
          year={year}
          onCancel={() => setAnother(false)}
          onDone={(words) => {
            setAnother(false)
            onDone(words)
          }}
        />
      )}
    </div>
  )
}
