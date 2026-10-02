import { useCallback, useMemo, useRef, useState } from 'react'

/** The lines with a write out (review m1): held at the tab, so moving to another line and back keeps them held. */
export interface InFlightLines {
  readonly has: (transactionCmId: number) => boolean
  /** Marks a line in flight; false when it already was (a second press, ignored). */
  readonly begin: (transactionCmId: number) => boolean
  readonly end: (transactionCmId: number) => void
}

export function useInFlightLines(): InFlightLines {
  // The ref answers a fast double click at once; the state re-renders the panels.
  const live = useRef(new Set<number>())
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set())
  const has = useCallback((txn: number) => held.has(txn), [held])
  const begin = useCallback((txn: number) => {
    if (live.current.has(txn)) return false
    live.current.add(txn)
    setHeld(new Set(live.current))
    return true
  }, [])
  const end = useCallback((txn: number) => {
    live.current.delete(txn)
    setHeld(new Set(live.current))
  }, [])
  return useMemo(() => ({ has, begin, end }), [has, begin, end])
}
