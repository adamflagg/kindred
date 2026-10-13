import { matchPath } from 'react-router'
import entries from './helpKeys.json'

export interface HelpKeyEntry {
  key: string
  area: string
  label: string
  path: string
  tab?: { value: string } // ?tab=<value> query tabs only
}

export const HELP_AREAS = [
  'home',
  'summer',
  'weekend',
  'aid',
  'analytics',
  'manage',
  'people',
] as const

const ENTRIES = entries as HelpKeyEntry[]

/** Specificity: tab entries first, then more literal segments, then fewer wildcards, then more params. */
function score(e: HelpKeyEntry): number {
  const segs = e.path.split('/').filter(Boolean)
  const literal = segs.filter((s) => !s.startsWith(':') && s !== '*').length
  const params = segs.filter((s) => s.startsWith(':')).length
  return (e.tab ? 1000 : 0) + literal * 10 + params - (e.path.endsWith('*') ? 5 : 0)
}

const ORDERED = [...ENTRIES].sort((a, b) => score(b) - score(a))

/** The help key for a location. Never throws; unknown places resolve to their area, then `home`. */
export function resolveHelpKey(pathname: string, search: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const query = new URLSearchParams(search)
  for (const e of ORDERED) {
    const m = matchPath({ path: e.path, end: !e.path.endsWith('*') }, path)
    if (!m) continue
    if (e.tab && query.get('tab') !== e.tab.value) continue
    return e.key
  }
  return 'home'
}
