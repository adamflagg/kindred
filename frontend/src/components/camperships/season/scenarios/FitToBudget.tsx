import type { ApiAidScenarioFit } from '../../../../types/api-types'
import { CS_BTN, CS_BTN2 } from '../../kit/csType'
import { fitWords } from './scenarioModel'
import { FIT_DONE, FIT_WARN } from './scenarioStyles'

const FIT_TITLE = "Shifts every tier's Round 1 % by the same points until Round 1 uses the budget"
// Which requests it moves once a round is posted, by Posted ▾ (owner, 2026-10-10: "as if nothing posted - all, regular -
// unposted"). Before any round posts the two are the same, so the title says neither.
const MOVES: Record<'all' | 'unposted', string> = {
  unposted: 'A posted Round 1 stands, so it moves only what is not posted yet',
  all: 'Priced as if nothing is posted, it moves every request',
}

/**
 * Fit to Budget, on the Tiers & Round 1 card's header (§S5 G). Its maths and route are unchanged (owner: "no changes
 * to the Fit work in this pass"). Why it is off ("Fit uses every application held", "Nothing is held yet") is the disabled button's title alone, never a line beside it (scenarios-13).
 */
export function FitToBudgetButton({
  disabled,
  reason,
  pending,
  onFit,
  moves = null,
}: {
  disabled: boolean
  /** Why it is off, for the title of the disabled button. */
  reason: string | null
  pending: boolean
  onFit: () => void
  /** Once a round is posted: whether it fits every request (as if nothing is posted) or only the unposted ones. */
  moves?: 'all' | 'unposted' | null
}) {
  return (
    <button
      type="button"
      className={`${CS_BTN2} ml-auto`}
      disabled={disabled || pending}
      title={
        disabled
          ? (reason ?? undefined)
          : moves === null
            ? FIT_TITLE
            : `${FIT_TITLE}. ${MOVES[moves]}`
      }
      onClick={onFit}
    >
      Fit to Budget
    </button>
  )
}

/**
 * Fit's answer, ONE line in the done box (amber when it can't fit, or the draft moved), between the settings line and
 * the grid (§S5 G): the words cut with an ellipsis, the tightest pool short beside them and in full in the title, then
 * Use It when it fits and Not Now.
 */
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
  const pool = answer.results.pools.find((p) => p.pool === answer.tightest_pool)
  const fits = !stale && answer.outcome === 'fits'
  return (
    <div
      data-testid="fit-answer"
      data-tone={fits ? 'done' : 'warn'}
      className={`${fits ? FIT_DONE : FIT_WARN} mt-1.5 mb-0.5`}
    >
      {stale ? (
        <span className="min-w-0 truncate">Your draft changed since: fit again.</span>
      ) : (
        <span className="min-w-0 truncate" title={words.pool ?? undefined}>
          {words.headline}
          {words.pool !== null && pool !== undefined && (
            <>
              {' '}
              <span className="text-muted-foreground">Tightest pool: {pool.label}</span>
            </>
          )}
        </span>
      )}
      {fits && (
        <button type="button" className={`${CS_BTN} ml-auto`} disabled={!canUse} onClick={onUse}>
          Use It
        </button>
      )}
      <button type="button" className={`${CS_BTN2} ${fits ? '' : 'ml-auto'}`} onClick={onDismiss}>
        Not Now
      </button>
    </div>
  )
}
