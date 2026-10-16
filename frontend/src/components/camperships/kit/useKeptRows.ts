import { useCallback, useState } from 'react'

const NONE: ReadonlySet<string> = new Set()

/**
 * The rows an action moved out of the page's filter, kept in view (design-language rule 22): `keep` after the action
 * succeeds; a new `scope` (another filter, view or season) lets them all go, as a reload does. Feed `kept` to
 * `keepInView` and AidTable `keptKeys`.
 */
export function useKeptRows(scope: string): {
  readonly kept: ReadonlySet<string>
  readonly keep: (key: string) => void
} {
  const [state, setState] = useState<{ scope: string; kept: ReadonlySet<string> }>({
    scope,
    kept: NONE,
  })
  // Adjusted while rendering (React's "storing information from previous renders"), so nothing draws stale.
  if (state.scope !== scope) setState({ scope, kept: NONE })
  const keep = useCallback((key: string) => {
    setState((now) => (now.kept.has(key) ? now : { ...now, kept: new Set([...now.kept, key]) }))
  }, [])
  return { kept: state.scope === scope ? state.kept : NONE, keep }
}
