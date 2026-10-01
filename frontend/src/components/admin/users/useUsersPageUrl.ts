import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import type { Bucket } from './usersPageModel'

export type UsersTab = 'users' | 'roles' | 'permissions'
const TABS: readonly UsersTab[] = ['users', 'roles', 'permissions']
const BUCKETS: readonly Bucket[] = ['admin', 'exec', 'other', 'none']

/**
 * The Users page's state in the URL (spec P2): a tab, filter or page is
 * linkable and survives reload. Updates replace, so Back leaves the page —
 * the useAidTableUrl convention. Search stays in component state.
 */
export function useUsersPageUrl() {
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab') as UsersTab | null
  const tab: UsersTab = rawTab && TABS.includes(rawTab) ? rawTab : 'users'
  const rawBucket = params.get('bucket') as Bucket | null
  const bucket = rawBucket && BUCKETS.includes(rawBucket) ? rawBucket : null
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const write = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v === null) next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true }
      ),
    [setParams]
  )

  return {
    tab,
    bucket,
    roleId: params.get('role'),
    page,
    focus: params.get('focus'),
    setTab: (t: UsersTab, focus?: string) =>
      write({
        tab: t === 'users' ? null : t,
        focus: focus ?? null,
        bucket: null,
        role: null,
        page: null,
      }),
    setBucket: (b: Bucket | null) => write({ bucket: b, role: null, page: null }),
    setRole: (id: string | null) =>
      write({ tab: null, role: id, bucket: null, page: null, focus: null }),
    setPage: (p: number) => write({ page: p > 1 ? String(p) : null }),
  }
}
