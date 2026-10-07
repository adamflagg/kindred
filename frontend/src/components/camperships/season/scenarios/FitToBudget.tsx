import type { ApiAidScenarioFit } from '../../../../types/api-types'
import { CS_BODY, CS_BTN, CS_BTN2, CS_SMALL } from '../../kit/csType'
import { fitWords } from './scenarioModel'
import { FIT_BOX } from './scenarioStyles'

/**
 * Fit to Budget, on the Tiers & Round 1 card's header (§S5 G). Its maths and route are unchanged (owner: "no changes
 * to the Fit work in this pass"). It is off after Round 1 posts, and while Price ▾ isn't "the applications held",
 * which it says beside it.
 */
export function FitToBudgetButton({
  disabled,
  reason,
  pending,
  onFit,
}: {
  disabled: boolean
  /** Shown beside the button while it is off for a reason staff can change (Price ▾). */
  reason: string | null
  pending: boolean
  onFit: () => void
}) {
  return (
    <span className="ml-auto flex items-center gap-2">
      {reason !== null && <span className={CS_SMALL}>{reason}</span>}
      <button type="button" className={CS_BTN2} disabled={disabled || pending} onClick={onFit}>
        Fit to Budget
      </button>
    </span>
  )
}

/** Fit's answer, in a dashed box under the tiers line (§S5 G): Use It when it fits, and Not Now. */
export function FitAnswer({
  answer,
  stale,
  canUse,
  onUse,
  onDismiss,
}: {
  answer: ApiAidScenarioFit
  /** The draft changed since it was asked: its figures are about another draft. */
  stale: boolean
  canUse: boolean
  onUse: () => void
  onDismiss: () => void
}) {
  const words = fitWords(answer)
  return (
    <div
      data-testid="fit-answer"
      className={`${FIT_BOX} ${CS_BODY} mt-2 flex flex-wrap items-center gap-2`}
    >
      {stale ? (
        <span className={CS_SMALL}>Your draft changed since: fit again.</span>
      ) : (
        <>
          <span>{words.headline}</span>
          {words.pool !== null && <span className={CS_SMALL}>{words.pool}</span>}
          {answer.outcome === 'fits' && (
            <button type="button" className={CS_BTN} disabled={!canUse} onClick={onUse}>
              Use It
            </button>
          )}
        </>
      )}
      <button type="button" className={CS_BTN2} onClick={onDismiss}>
        Not Now
      </button>
    </div>
  )
}
