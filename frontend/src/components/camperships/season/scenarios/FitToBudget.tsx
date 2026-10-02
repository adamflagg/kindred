import { useState } from 'react'

import { useAidScenarioFit } from '../../../../hooks/camperships/useAidPromotion'
import type { ApiAidRulesDocumentIn } from '../../../../types/api-types'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { fitWords } from './scenarioModel'

/**
 * Fit to budget (spec §7.4; D119; fit.py): finds the shift every tier by that uses Round 1's
 * allocation, naming the tightest pool as information. It records nothing until "Use it", which
 * records the fitted document as the draft (a trail row, like any release), on the trail row the
 * fit was asked on: if the draft has moved since, the record is refused rather than overwriting it.
 */
export function FitToBudget({
  document,
  trailId,
  disabled,
  editing,
  onUse,
}: {
  document: ApiAidRulesDocumentIn
  /** The draft's current trail row: noted when the fit is asked. */
  trailId: string
  /** A write is running, or a slider has moved and not been let go. */
  disabled: boolean
  /** An All settings editor holds typing: no fitted draft may land under it (Decision 15). */
  editing: boolean
  /** Resolves true once the record landed; the fitted answer is kept until then. */
  onUse: (fitted: ApiAidRulesDocumentIn, askedOn: string) => Promise<boolean>
}) {
  const fit = useAidScenarioFit()
  const [askedOn, setAskedOn] = useState<string | null>(null)
  const answer = fit.data
  // The answer belongs to the draft it was fitted on: once that moves, its figures are about another.
  const stale = answer !== undefined && askedOn !== null && askedOn !== trailId
  const words = answer === undefined || stale ? null : fitWords(answer)
  return (
    <div className="card-lodge space-y-2 px-3 py-2 text-sm" data-testid="fit-to-budget">
      <button
        type="button"
        className={BUTTON_SECONDARY}
        disabled={disabled || fit.isPending}
        onClick={() => {
          setAskedOn(trailId)
          fit.mutate(document)
        }}
      >
        {fit.isPending
          ? 'Fitting…'
          : "Fit to budget: find the shift that uses Round 1's allocation"}
      </button>
      {fit.error !== null && <p className={AMBER_NOTE}>{fit.error.message}</p>}
      {stale && (
        <p className="text-muted-foreground text-xs">Your draft changed since: fit again.</p>
      )}
      {answer !== undefined && words !== null && (
        <div className="space-y-1">
          <p>{words.headline}</p>
          {words.pool !== null && <p className="text-muted-foreground text-xs">{words.pool}</p>}
          <div className="flex gap-2">
            {answer.outcome === 'fits' && askedOn !== null && (
              <button
                type="button"
                className={BUTTON_PRIMARY}
                disabled={disabled || editing}
                onClick={() => {
                  void onUse(answer.document, askedOn).then((landed) => {
                    if (landed) fit.reset()
                  })
                }}
              >
                Use it
              </button>
            )}
            <button type="button" className={BUTTON_SECONDARY} onClick={() => fit.reset()}>
              Not now
            </button>
            {editing && answer.outcome === 'fits' && (
              <span className="text-muted-foreground self-center text-xs">
                Save or cancel the edit first.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
