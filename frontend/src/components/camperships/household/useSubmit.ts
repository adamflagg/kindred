import { useEffect, useRef, useState } from 'react'

type Write = () => Promise<unknown>

/**
 * Saving and its refusal, for one confirm-style form (PR 8's CancelForm/ReasonForm pattern): one
 * submit outstanding at a time (the ref, so a second Enter in the same tick is ignored too), the
 * server's own words on a refusal, and nothing set after the form is gone. These forms don't register
 * with the page's `leave()`: saving on leave would act without confirmation.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  /** `check` returns the problem to show, or the write to send. */
  const attempt = (check: () => string | Write) => {
    if (inFlight.current) return
    const next = check()
    if (typeof next === 'string') {
      setError(next)
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await next()
      } catch (caught) {
        if (mounted.current) setError(caught instanceof Error ? caught.message : "Couldn't save")
      } finally {
        inFlight.current = false
        if (mounted.current) setBusy(false)
      }
    })()
  }
  return { busy, error, attempt }
}
