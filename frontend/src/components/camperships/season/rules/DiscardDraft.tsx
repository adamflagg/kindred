import { useState } from 'react'

import { useAidDiscardRulesDraft } from '../../../../hooks/camperships/useAidRulesWrites'
import { CS_BTN2, CS_SMALL } from '../../kit/csType'
import { useSeasonChrome } from '../seasonChrome'

/**
 * Discard draft (owner 2026-10-08), beside the draft / in-effect switch: asks once more, then throws the draft away
 * and the tab is back on the version in effect. A refusal goes to the Season notice line, in the server's words.
 */
export function DiscardDraft({
  draftVersion,
  approvedVersion,
}: {
  draftVersion: number
  approvedVersion: number
}) {
  const discard = useAidDiscardRulesDraft()
  const { setNotice } = useSeasonChrome()
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" className={CS_BTN2} onClick={() => setAsking(true)}>
        Discard draft
      </button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className={CS_SMALL}>
        {`Discard draft v${String(draftVersion)}? Its changes since v${String(approvedVersion)} are lost.`}
      </span>
      <button
        type="button"
        className={CS_BTN2}
        disabled={discard.isPending}
        // mutateAsync, not mutate's callbacks: a refusal because the draft moved on refetches a new draft version,
        // which re-keys this button, and React Query skips mutate()'s callbacks for a component that is gone.
        onClick={() => {
          discard
            .mutateAsync({ base_version: draftVersion })
            .then(() => setAsking(false))
            .catch((caught: unknown) => {
              setAsking(false)
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
        onClick={() => setAsking(false)}
      >
        Keep
      </button>
    </span>
  )
}
