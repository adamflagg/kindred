import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Reads and writes the `?pin=<requestId>` URL query parameter.
 *
 * Used by the Bunk Requests review panel to keep a chosen request visible
 * and highlighted, even if active filters would otherwise hide it.
 */
export function usePinnedRequest(): {
  pinnedId: string | null
  setPinnedId: (id: string | null) => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const pinnedId = searchParams.get('pin')

  const setPinnedId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) {
            next.set('pin', id)
          } else {
            next.delete('pin')
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  return { pinnedId, setPinnedId }
}
