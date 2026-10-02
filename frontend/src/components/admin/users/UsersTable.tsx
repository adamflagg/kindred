import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Search, X } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import type { RecordModel } from 'pocketbase'
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
import { UserAvatar } from './UserAvatar'
import { ROLE_CHIP } from './styles'
import type { UsersPageProps } from './types'

export const PER_PAGE = 15

const BUCKETS: Array<[Bucket | null, string]> = [
  [null, 'All'],
  ['admin', 'Admin'],
  ['exec', 'Executive'],
  ['other', 'Other roles'],
  ['none', 'No role'],
]

const FRESH_DOT: Record<string, string> = {
  fresh: 'bg-emerald-500',
  stale: 'bg-amber-500',
  never: 'border border-muted-foreground/60',
  '': 'bg-muted-foreground/40',
}

const TH =
  'text-muted-foreground px-3.5 py-2 text-left text-[11px] font-semibold tracking-wider whitespace-nowrap uppercase'
const TD = 'px-3.5 py-[7px] whitespace-nowrap'

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
            // A role filter replaces the bucket, so no bucket reads as active beside it.
            const active = url.bucket === id && !roleFilter
            const n = id ? counts[id] : counts.all
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
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
              <span className="bg-muted-foreground/40 h-2 w-2 rounded-full" /> 8–45 days
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
          data-testid="users-pager"
          className={`text-muted-foreground flex items-center gap-2 text-sm ${
            canSeeLastLogin ? 'border-border border-l pl-3' : 'ml-auto'
          }`}
        >
          <span className="tabular-nums">
            {paged.items.length === 0 ? (
              'Nobody matches'
            ) : (
              <>
                <b>{`${String(paged.start + 1)}–${String(paged.start + paged.items.length)}`}</b> of{' '}
                <b>{filtered.length}</b>
              </>
            )}
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
                <tr className="border-border bg-muted/55 border-b">
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
                  const isSelf = user.id === currentUser?.id
                  const isAdminUser = Boolean(user['is_admin'])
                  const manageable = canManage(user)
                  const mine = data.held.get(user.id) ?? []
                  const lastSeen = String(user['last_seen'] ?? '')
                  const created = String(user['created'] ?? '')
                  const fresh = freshness(lastSeen, now)
                  const selected = openUserId === user.id
                  return (
                    <tr
                      key={user.id}
                      data-testid={`user-row-${user.id}`}
                      data-selected={selected || undefined}
                      onClick={manageable ? () => setOpenUserId(user.id) : undefined}
                      className={`border-border/50 border-b last:border-b-0 ${
                        selected ? 'bg-primary/8' : 'hover:bg-muted/50'
                      } ${manageable ? 'cursor-pointer' : ''}`}
                    >
                      <td
                        className={`${TD} ${selected ? 'shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <UserAvatar user={user} />
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
                      <td className={`${TD} text-muted-foreground`}>
                        <span className="block max-w-[260px] truncate">{email}</span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-nowrap gap-1">
                          {isAdminUser ? (
                            <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[12.5px] leading-[18px] font-medium whitespace-nowrap text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
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
                                className={ROLE_CHIP}
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
                          className={`${TD} text-muted-foreground`}
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
                      <td className={`${TD} text-muted-foreground`}>
                        {created ? format(new Date(created.replace(' ', 'T')), 'MMM d, yyyy') : ''}
                      </td>
                      <td className={`${TD} text-muted-foreground text-right`}>
                        {manageable ? (
                          <ChevronRight className="inline h-4 w-4" />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Lock className="h-3 w-3" />
                            {isSelf
                              ? 'You'
                              : isAdminUser
                                ? 'Admin'
                                : canSeeLastLogin
                                  ? ''
                                  : 'View only'}
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
