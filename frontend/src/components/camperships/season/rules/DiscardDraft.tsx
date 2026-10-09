import { useAidDiscardRulesDraft } from '../../../../hooks/camperships/useAidRulesWrites'
import { CS_BTN2 } from '../../kit/csType'
import { useSeasonChrome } from '../seasonChrome'

/**
 * Discard Draft… (owner 2026-10-08), beside the draft / in-effect switch. Clicking it asks once more, INLINE on the
 * chapter bar (final mock P.discardAsk): the lead line carries the question ("Discard v4? Changes since v3 are lost.")
 * and this draws its Discard and Keep buttons. The tab owns `asking`, so the bar can step Open All / Close All aside
 * while the question is open. A refusal goes to the Season notice line, in the server's words.
 */
export function DiscardDraft({
  draftVersion,
  approvedVersion,
  asking,
  onAsk,
}: {
  draftVersion: number
  approvedVersion: number
  asking: boolean
  onAsk: (asking: boolean) => void
}) {
  const discard = useAidDiscardRulesDraft()
  const { setNotice } = useSeasonChrome()
  if (!asking) {
    return (
      <button
        type="button"
        className={CS_BTN2}
        title={`Throws draft v${String(draftVersion)} away; the tab goes back to v${String(approvedVersion)}, the version in effect`}
        onClick={() => onAsk(true)}
      >
        Discard Draft…
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        className={CS_BTN2}
        disabled={discard.isPending}
        // mutateAsync, not mutate's callbacks: a refusal because the draft moved on refetches a new draft version,
        // which re-keys this button, and React Query skips mutate()'s callbacks for a component that is gone.
        onClick={() => {
          discard
            .mutateAsync({ base_version: draftVersion })
            .then(() => onAsk(false))
            .catch((caught: unknown) => {
              onAsk(false)
              setNotice(caught instanceof Error ? caught.message : String(caught))
            })
        }}
      >
        {discard.isPending ? 'Discarding…' : 'Discard'}
      </button>
      <button
        type="button"
        className={CS_BTN2}
        disabled={discard.isPending}
        onClick={() => onAsk(false)}
      >
        Keep
      </button>
    </>
  )
}
