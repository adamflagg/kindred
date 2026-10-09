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
  CS_LINK_SM,
  CS_PANEL_HEAD,
  CS_PANEL_RULE,
  CS_PMETA,
} from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { refusalWords } from '../money/refusal'
import { EffectList } from '../money/ToPlaceParts'
import { PlaceCamperForm } from './PlaceCamperForm'
import {
  evidenceLines,
  grantEffects,
  placedGrantWords,
  placementFor,
  stillNeedsCamper,
  suggestionShort,
} from './placeModel'

const THREE_PANELS =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)] items-stretch text-sm'
const PANEL = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const MIDDLE = `flex min-w-0 flex-col gap-1 border-r px-4 ${CS_PANEL_RULE}`
const LAST = 'flex min-w-0 flex-col gap-1.5 pl-4'

/**
 * A "needs a camper" line opened (owner ruling A; spec §8.2; D16, D126; final UX §16, §24): left, the
 * line in CampMinder; middle, the suggestion and its evidence one fact per line, and the household's
 * campers; right, what Confirm does (one effect per line), then Confirm (the suggestion, its session
 * with it) and Another Camper… (casework). Another Camper… opens its editor under the three panels,
 * the whole opened row's width. Each reads the line again just before sending (P-9): a placement
 * overwrites, so a line placed meanwhile is never re-placed.
 */
export function NeedsCamperPanel({
  need,
  year,
  view,
  sessions,
  canWork,
  onDone,
}: {
  need: ApiAidNeedsCamper
  year: number
  view: AidView
  /** Session names by id (useAidSessionNames), for the suggestion's "camper · session". */
  sessions: ReadonlyMap<number, string> | undefined
  canWork: boolean
  onDone: (words: string) => void
}) {
  const place = useAidPlaceGrants()
  const fresh = useFreshAidGrants()
  const [another, setAnother] = useState(false)
  // True from the click until the check and the write settle: Another Camper… waits too.
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const inFlight = useRef(false)
  const suggestion = need.suggestion

  const confirm = async () => {
    if (inFlight.current || suggestion === null) return
    inFlight.current = true
    setConfirming(true)
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
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="needs-camper-panel">
      <div className={THREE_PANELS}>
        <div className={PANEL} data-panel="line">
          <div className={CS_PANEL_HEAD}>The grant line in CampMinder</div>
          <div>
            <b>{formatMoney(need.grant.amount)}</b>
            {` · ${grantLineBare(need)}`}
          </div>
          {need.grant.description !== '' && (
            <div className={CS_PMETA}>{need.grant.description}</div>
          )}
          <Link
            className={CS_LINK_SM}
            to={aidHref(`/aid/households/${String(need.grant.household_cm_id)}`, view)}
          >
            Open the Household ›
          </Link>
        </div>
        <div className={MIDDLE} data-panel="suggestion">
          <div className={CS_PANEL_HEAD}>Suggestion</div>
          {suggestion === null ? (
            <div className={CS_PMETA}>No suggestion: pick the camper.</div>
          ) : (
            <div>
              <b>{suggestionShort(need, sessions)}</b>
            </div>
          )}
          {evidenceLines(need).map((fact) => (
            <div key={fact} className={CS_PMETA}>
              {fact}
            </div>
          ))}
          <div className={CS_PMETA}>
            {need.candidates.length === 0
              ? 'No camper in the household this season.'
              : `Campers in the household: ${need.candidates.map((c) => c.name).join(', ')}`}
          </div>
        </div>
        <div className={LAST} data-panel="actions">
          <div className={CS_PANEL_HEAD}>What Confirm does</div>
          <EffectList lines={grantEffects(need, sessions)} />
          {canWork && !another && (
            <div className="flex flex-wrap gap-2 pt-1">
              {suggestion !== null && (
                <button
                  type="button"
                  className={CS_BTN}
                  disabled={place.isPending}
                  onClick={() => void confirm()}
                >
                  {place.isPending ? 'Placing…' : 'Confirm'}
                </button>
              )}
              {need.candidates.length > 0 && (
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={confirming}
                  onClick={() => setAnother(true)}
                >
                  Another Camper…
                </button>
              )}
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

/** The line's words without its amount, which is drawn bold before them. */
function grantLineBare(need: ApiAidNeedsCamper): string {
  const g = need.grant
  const who = g.grantor_key === '' ? g.description || 'no grantor yet' : g.grantor_name
  return [
    who,
    'posted to the household',
    ...(g.recorded_on === '' ? [] : [formatShortDate(g.recorded_on)]),
  ].join(' · ')
}
