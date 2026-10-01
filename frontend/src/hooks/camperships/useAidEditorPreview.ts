import { useCallback, useEffect, useRef, useState } from 'react'

import {
  toEditorPreview,
  type PreviewHousehold,
} from '../../components/camperships/kit/editorPreview'
import type { EditorPreview } from '../../components/camperships/kit/RequestEditor'
import { previewAidEdit } from '../../services/camperships/aidApi'
import { useApiWithAuth } from '../useApiWithAuth'

/** About one season read per call (#2924 Decision 13), so typing pauses before it asks. */
const DEBOUNCE_MS = 300

/**
 * The editor's line while typing (§4.6; D22): a debounced POST /requests/{id}/preview, never cached
 * (a POST). A newer amount cancels the older call, so a slow answer never overwrites a newer one.
 * State changes only in the handler and in the call's own answer, never in an effect.
 */
export function useAidEditorPreview(
  requestId: string,
  round: 2 | 3,
  householdOf: (householdCmId: number) => PreviewHousehold
): { preview: EditorPreview; onAmountChange: (amount: number | null) => void } {
  const { fetchWithAuth } = useApiWithAuth()
  const [preview, setPreview] = useState<EditorPreview>({ status: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<AbortController | null>(null)
  const householdRef = useRef(householdOf)
  useEffect(() => {
    householdRef.current = householdOf
  })
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
    },
    []
  )

  const onAmountChange = useCallback(
    (amount: number | null) => {
      if (timer.current !== null) clearTimeout(timer.current)
      inFlight.current?.abort()
      if (amount === null) {
        setPreview({ status: 'idle' })
        return
      }
      setPreview({ status: 'loading' })
      timer.current = setTimeout(() => {
        const controller = new AbortController()
        inFlight.current = controller
        void previewAidEdit(fetchWithAuth, requestId, { round, amount }, controller.signal)
          .then((out) => {
            if (!controller.signal.aborted) setPreview(toEditorPreview(out, householdRef.current))
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return
            setPreview({
              status: 'error',
              error: error instanceof Error ? error.message : "Couldn't work out the award",
            })
          })
      }, DEBOUNCE_MS)
    },
    [fetchWithAuth, requestId, round]
  )

  return { preview, onAmountChange }
}
