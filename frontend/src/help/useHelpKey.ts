import { useLocation } from 'react-router'
import { resolveHelpKey } from './resolveHelpKey'

/** The help key for the screen the user is on, so a Help-menu link can point at its guide page. */
export function useHelpKey(): string {
  const { pathname, search } = useLocation()
  return resolveHelpKey(pathname, search)
}
