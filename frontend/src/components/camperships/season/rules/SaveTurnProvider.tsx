import { useState, type ReactNode } from 'react'

import { SaveTurnContext } from './saveTurn'

/** Holds which cards are saving, so each card's Save waits its turn (saveTurn.ts). */
export function SaveTurnProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [mark] = useState(
    () => (key: string, saving: boolean) =>
      setBusy((now) => {
        if (now.has(key) === saving) return now
        const next = new Set(now)
        if (saving) next.add(key)
        else next.delete(key)
        return next
      })
  )
  return <SaveTurnContext.Provider value={{ busy, mark }}>{children}</SaveTurnContext.Provider>
}
