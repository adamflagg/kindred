import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Search, X } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import type { RecordModel } from 'pocketbase'
import { pb } from '../../../lib/pocketbase'
import { useAuth } from '../../../contexts/AuthContext'
import { usePermissions } from '../../../hooks/usePermissions'
import { Permission } from '../../../constants/permissions'
import {
  PAGE_BUTTON,
  PAGER_BUTTON,
  PAGER_BUTTON_CURRENT,
  pageWindow,
} from '../../ui/paginationParts'
import { bucketCounts, filterUsers, freshness, pageOf, type Bucket } from './usersPageModel'
import { UserDrawer } from './UserDrawer'
import type { UsersPageProps } from './types'

export const PER_PAGE = 15

const BUCKETS: Array<[Bucket | null, string]> = [
  [null, 'All'],
  ['admin', 'Admin'],
  ['exec', 'Executive'],
  ['other', 'Other roles'],
  ['none', 'No role'],
]

const AVATAR_COLORS = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
]

/** A consistent avatar background from a string. */
function getAvatarColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return (
    AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ??
    'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  )
}

const FRESH_DOT: Record<string, string> = {
  fresh: 'bg-emerald-500',
  stale: 'bg-amber-500',
  never: 'border border-muted-foreground/60',
  '': 'bg-muted-foreground/40',
}

const TH =
  'text-muted-foreground px-3.5 py-2 text-left text-[11px] font-semibold tracking-wider uppercase'

export function UsersTable({ data, registry, url }: UsersPageProps) {
  const { user: currentUser } = useAuth()
  const { isAdmin, hasPermission } = usePermissions()
  const [search, setSearch] = useState('')
  const [openUserId, setOpenUserId] = useState<string | null>(null)

  const canSeeLastLogin = isAdmin || hasPermission(Permission.USERS_MANAGE)
  const canManage = (u: RecordModel) =>
    u.id !== currentUser?.id && !u['is_admin'] && canSeeLastLogin

  const counts = useMemo(() => bucketCounts(data.users, data.held), [data.users, data.held])
  // A ?role= naming a role that no longer exists is ignored: filtering by it would
  // show "Nobody matches" with no chip to clear.
  const roleFilter = url.roleId ? data.roles.find((r) => r.id === url.roleId) : undefined
  const roleId = roleFilter ? url.roleId : null
  const filtered = useMemo(
    () => filterUsers(data.users, data.held, { search, bucket: url.bucket, roleId }),
    [data.users, data.held, search, url.bucket, roleId]
  )
  const paged = pageOf(filtered, url.page, PER_PAGE)
  const openUser = openUserId ? data.users.find((u) => u.id === openUserId) : undefined
  const now = new Date()

  return (
    <div data-testid="users-table" className="space-y-3">
      <div data-testid="users-toolbar" className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              url.setPage(1)
            }}
            placeholder="Search name or email"
            className="bg-card border-border h-[34px] w-60 rounded-lg border pr-3 pl-8 text-sm"
          />
        </div>
        <div className="bg-muted/50 border-border/50 flex gap-1 rounded-xl border p-1">
          {BUCKETS.map(([id, label]) => {
            const active = url.bucket === id
            const n = id ? counts[id] : counts.all
            return (
              <button
                key={label}
                type="button"
                onClick={() => url.setBucket(active ? null : id)}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                {label} <span className="tabular-nums opacity-75">{n}</span>
              </button>
            )
          })}
        </div>
        {roleFilter && (
          <span
            data-testid="role-filter"
            className="bg-primary/12 text-primary inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm"
          >
            Role: <b>{roleFilter.name}</b>
            <button type="button" aria-label="Clear role filter" onClick={() => url.setRole(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        {canSeeLastLogin && (
          <span className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> this week
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> 45+ days
            </span>
            <span className="flex items-center gap-1">
              <span className="border-muted-foreground/60 h-2 w-2 rounded-full border" /> never
            </span>
          </span>
        )}
        <div
          className={`text-muted-foreground flex items-center gap-1.5 text-sm ${
            canSeeLastLogin ? '' : 'ml-auto'
          }`}
        >
          <span className="tabular-nums">
            {paged.items.length === 0
              ? 'Nobody matches'
              : `${String(paged.start + 1)}–${String(paged.start + paged.items.length)} of ${String(filtered.length)}`}
          </span>
          {paged.pages > 1 && (
            <>
              <button
                type="button"
                className={PAGER_BUTTON}
                disabled={paged.page <= 1}
                onClick={() => url.setPage(paged.page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageWindow(paged.page, paged.pages).map((p, i) =>
                p === 'gap' ? (
                  <span key={`gap-${String(i)}`}>…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={p === paged.page ? PAGER_BUTTON_CURRENT : PAGE_BUTTON}
                    onClick={() => url.setPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                className={PAGER_BUTTON}
                disabled={paged.page >= paged.pages}
                onClick={() => url.setPage(paged.page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {data.users.length === 0 ? (
        <div className="text-muted-foreground bg-card border-border rounded-xl border p-8 text-center text-sm">
          Users will appear here after signing in via Pocket ID
        </div>
      ) : (
        <div className="bg-card border-border overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className={TH}>Person</th>
                  <th className={TH}>Email</th>
                  <th className={TH}>Roles</th>
                  {canSeeLastLogin && <th className={TH}>Last active</th>}
                  <th className={TH}>Joined</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {paged.items.map((user) => {
                  const email = String(user['email'] ?? '')
                  const rawName = String(user['name'] ?? '')
                  const name = rawName === '' ? (email.split('@')[0] ?? '') : rawName
                  const avatar = String(user['avatar'] ?? '')
                  const isSelf = user.id === currentUser?.id
                  const isAdminUser = Boolean(user['is_admin'])
                  const manageable = canManage(user)
                  const mine = data.held.get(user.id) ?? []
                  const lastSeen = String(user['last_seen'] ?? '')
                  const created = String(user['created'] ?? '')
                  const fresh = freshness(lastSeen, now)
                  return (
                    <tr
                      key={user.id}
                      data-testid={`user-row-${user.id}`}
                      onClick={manageable ? () => setOpenUserId(user.id) : undefined}
                      className={`border-border/50 hover:bg-muted/50 border-b last:border-b-0 ${
                        manageable ? 'cursor-pointer' : ''
                      }`}
                    >
                      <td className="px-3.5 py-[7px]">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ${
                              avatar ? '' : getAvatarColor(email)
                            }`}
                          >
                            {avatar ? (
                              <img
                                src={pb.files.getURL(user, avatar, { thumb: '56x56' })}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              (name === '' ? email : name).charAt(0).toUpperCase()
                            )}
                          </span>
                          {manageable ? (
                            <button
                              type="button"
                              data-testid={`manage-${user.id}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenUserId(user.id)
                              }}
                              className="text-foreground text-left font-semibold"
                            >
                              {name}
                            </button>
                          ) : (
                            <span className="text-foreground font-semibold">{name}</span>
                          )}
                          {isSelf && (
                            <span className="bg-muted text-muted-foreground rounded-md px-1.5 text-xs">
                              you
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-muted-foreground px-3.5 py-[7px]">{email}</td>
                      <td className="px-3.5 py-[7px]">
                        <div className="flex flex-wrap gap-1">
                          {isAdminUser ? (
                            <span className="rounded-md bg-purple-100 px-1.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                              Admin · everything
                            </span>
                          ) : mine.length > 0 ? (
                            mine.map((role) => (
                              <button
                                key={role.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  url.setRole(role.id)
                                }}
                                className="bg-primary/12 text-primary rounded-md px-1.5 text-xs font-medium"
                              >
                                {role.name}
                              </button>
                            ))
                          ) : (
                            <span className="text-muted-foreground">No role</span>
                          )}
                        </div>
                      </td>
                      {canSeeLastLogin && (
                        <td
                          data-testid={`last-active-${user.id}`}
                          className="text-muted-foreground px-3.5 py-[7px]"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${FRESH_DOT[fresh] ?? ''}`} />
                            {lastSeen
                              ? formatDistanceToNow(new Date(lastSeen.replace(' ', 'T')), {
                                  addSuffix: true,
                                })
                              : 'Never'}
                          </span>
                        </td>
                      )}
                      <td className="text-muted-foreground px-3.5 py-[7px]">
                        {created ? format(new Date(created.replace(' ', 'T')), 'MMM d, yyyy') : ''}
                      </td>
                      <td className="text-muted-foreground px-3.5 py-[7px] text-right">
                        {manageable ? (
                          <ChevronRight className="inline h-4 w-4" />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Lock className="h-3 w-3" />
                            {isSelf ? 'You' : isAdminUser ? 'Admin' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openUser && (
        <UserDrawer
          user={openUser}
          data={data}
          registry={registry}
          onClose={() => setOpenUserId(null)}
        />
      )}
    </div>
  )
}
