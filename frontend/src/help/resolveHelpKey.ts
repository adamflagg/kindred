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

/** First literal path segment -> area. An area whose screens share no prefix (people:
 * /campers, /camper, /users, /user) still gets its fallback from every screen's segment. */
const AREA_BY_SEGMENT = new Map(
  ENTRIES.flatMap((e) => {
    const first = e.path.split('/').filter(Boolean)[0]
    return first && !first.startsWith(':') && first !== '*'
      ? [[first.toLowerCase(), e.area] as const]
      : []
  })
)

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
  const first = path.split('/').filter(Boolean)[0]?.toLowerCase()
  return AREA_BY_SEGMENT.get(first ?? '') ?? 'home'
}
