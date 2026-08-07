import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { Users as UsersIcon, Mail, Calendar, Shield, ShieldCheck, LogIn } from 'lucide-react'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '../constants/permissions'
import { formatDistanceToNow } from 'date-fns'
import { RolesTab } from './admin/RolesTab'
import { UserRolesPanel } from './admin/UserRolesPanel'
import type { RecordModel } from 'pocketbase'
import type { Role, UserRole } from '../types/rbac'

// Generate consistent color from string (for avatar backgrounds)
function getAvatarColor(str: string): string {
  const colors = [
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return (
    colors[Math.abs(hash) % colors.length] ??
    'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  )
}

type Tab = 'users' | 'roles'

export default function Users() {
  const { user: currentUser } = useAuth()
  const { isAdmin, hasPermission } = usePermissions()
  const canManageUser = (user: RecordModel) => {
    if (user.id === currentUser?.id) return false // can't manage self
    if (user['is_admin']) return false // can't manage admins
    return isAdmin || hasPermission(Permission.USERS_MANAGE)
  }
  const canSeeLastLogin = isAdmin || hasPermission(Permission.USERS_MANAGE)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('users')
  const [selectedUser, setSelectedUser] = useState<RecordModel | null>(null)

  const {
    data: users = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async () => {
      const result = await pb.collection('users').getList<RecordModel>(1, 1000, {
        sort: 'name',
        requestKey: null,
      })
      return result.items
    },
    ...userDataOptions,
  })

  const { data: roles = [] } = useQuery({
    queryKey: queryKeys.roles(),
    queryFn: async () => {
      return pb.collection('roles').getFullList<Role>({
        sort: 'name',
        requestKey: null,
      })
    },
    ...userDataOptions,
  })

  const { data: allUserRoles = [] } = useQuery({
    queryKey: queryKeys.userRoles(),
    queryFn: async () => {
      return pb.collection('user_roles').getFullList<UserRole>({
        requestKey: null,
      })
    },
    ...userDataOptions,
  })

  // Build a map: userId -> role names
  const roleMap = new Map<string, Role>()
  for (const role of roles) {
    roleMap.set(role.id, role)
  }

  function getRoleBadges(userId: string): Role[] {
    return allUserRoles
      .filter((ur) => ur.user === userId)
      .map((ur) => roleMap.get(ur.role))
      .filter((r): r is Role => r !== undefined)
  }

  function handleUserClick(user: RecordModel) {
    if (!canManageUser(user)) return
    setSelectedUser(selectedUser?.id === user.id ? null : user)
  }

  function handleClosePanel() {
    setSelectedUser(null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.userRoles() })
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="rounded-lg bg-white/10 p-1.5 sm:p-2">
              <Shield className="h-5 w-5 text-amber-400 sm:h-6 sm:w-6" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white sm:text-xl">
                System Access
              </h1>
              <p className="text-forest-200 text-xs sm:text-sm">
                Users authenticated via Pocket ID
              </p>
            </div>
          </div>
          {!isLoading && !error && activeTab === 'users' && (
            <div className="text-right">
              <div className="font-display text-lg font-bold text-white tabular-nums sm:text-xl">
                {users.length}
              </div>
              <div className="text-forest-300 text-xs sm:text-sm">
                {users.length === 1 ? 'user' : 'users'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-border flex gap-1 border-b">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'users'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <UsersIcon className="h-4 w-4" />
            Users
          </span>
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'roles'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Roles
          </span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'roles' ? (
        <RolesTab />
      ) : (
        <>
          {/* Users Tab Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="spinner-lodge" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center sm:p-6 dark:border-red-800 dark:bg-red-950/30">
              <h2 className="font-display mb-2 text-base font-bold text-red-800 sm:text-lg dark:text-red-200">
                Error Loading Users
              </h2>
              <p className="mb-4 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'Failed to fetch users'}
              </p>
              <button onClick={() => void refetch()} className="btn-primary">
                Try Again
              </button>
            </div>
          ) : users.length === 0 ? (
            <div className="bg-card border-border rounded-xl border p-8 text-center sm:p-12">
              <UsersIcon className="text-muted-foreground/50 mx-auto mb-4 h-10 w-10 sm:h-12 sm:w-12" />
              <h2 className="font-display text-foreground mb-2 text-base font-semibold sm:text-lg">
                No Users Yet
              </h2>
              <p className="text-muted-foreground text-sm">
                Users will appear here after signing in via Pocket ID
              </p>
            </div>
          ) : (
            <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-xl border shadow-sm">
              {users.map((user, index) => {
                const userRoleBadges = getRoleBadges(user.id)
                const userIsAdmin = Boolean(user['is_admin'])
                const email = (user['email'] as string) || ''
                const name = (user['name'] as string) || ''
                const avatar = user['avatar'] as string | undefined
                const created = (user['created'] as string) || ''
                const lastLogin = (user['last_login'] as string) || ''

                const isManageable = canManageUser(user)
                const rowClassName = `hover:bg-muted/50 dark:hover:bg-muted/30 flex w-full items-center gap-3 px-3 py-3 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4 ${
                  isManageable ? 'cursor-pointer' : ''
                } ${selectedUser?.id === user.id ? 'bg-muted/50 dark:bg-muted/30' : ''}`
                const rowStyle = { animationDelay: `${index * 30}ms` }

                // A row is only ever interactive for a manageable user. Rather
                // than bolt a keyboard listener onto a div that no-ops for
                // everyone else, a manageable row is a real <button> (native
                // Enter/Space) and a non-manageable row gets no button at all —
                // same rule GeoDetailList's rows follow (kindred#2063).
                const rowContent = (
                  <>
                    {/* Avatar */}
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full sm:h-11 sm:w-11 ${
                        avatar ? '' : getAvatarColor(email)
                      }`}
                    >
                      {avatar ? (
                        <img
                          src={pb.files.getURL(user, avatar, { thumb: '44x44' })}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-semibold sm:text-base">
                          {(name || email).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* User Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate text-sm font-medium sm:text-base">
                          {name || email.split('@')[0]}
                        </span>
                        {userIsAdmin && (
                          <span className="rounded-md bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            Admin
                          </span>
                        )}
                        {userRoleBadges.map((role) => (
                          <span
                            key={role.id}
                            className="bg-primary/10 text-primary hidden rounded-md px-1.5 py-0.5 text-xs font-medium sm:inline-block"
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1.5 text-xs sm:text-sm">
                        <Mail className="h-3 w-3 flex-shrink-0 sm:h-3.5 sm:w-3.5" />
                        <span className="truncate">{email}</span>
                      </div>
                    </div>

                    {/* Join Date */}
                    {created && (
                      <div className="text-muted-foreground hidden w-36 flex-shrink-0 flex-col items-start text-sm sm:flex">
                        <span className="text-[10px] tracking-wider uppercase opacity-60">
                          Joined
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{formatDistanceToNow(new Date(created), { addSuffix: true })}</span>
                        </div>
                      </div>
                    )}

                    {/* Last Login — admin/user-manager only */}
                    {canSeeLastLogin &&
                      (lastLogin ? (
                        <div
                          data-testid={`last-login-${user.id}`}
                          className="text-muted-foreground hidden w-36 flex-shrink-0 flex-col items-start text-sm sm:flex"
                          title={new Date(lastLogin).toLocaleString()}
                        >
                          <span className="text-[10px] tracking-wider uppercase opacity-60">
                            Last login
                          </span>
                          <div className="flex items-center gap-1.5">
                            <LogIn className="h-3.5 w-3.5" />
                            <span>
                              {formatDistanceToNow(new Date(lastLogin), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div
                          data-testid={`last-login-${user.id}`}
                          className="text-muted-foreground/50 hidden w-36 flex-shrink-0 flex-col items-start text-sm sm:flex"
                        >
                          <span className="text-[10px] tracking-wider uppercase opacity-60">
                            Last login
                          </span>
                          <div className="flex items-center gap-1.5">
                            <LogIn className="h-3.5 w-3.5" />
                            <span>Never</span>
                          </div>
                        </div>
                      ))}
                  </>
                )

                return (
                  <div key={user.id}>
                    {isManageable ? (
                      <button
                        type="button"
                        className={rowClassName}
                        style={rowStyle}
                        onClick={() => handleUserClick(user)}
                      >
                        {rowContent}
                      </button>
                    ) : (
                      <div className={rowClassName} style={rowStyle}>
                        {rowContent}
                      </div>
                    )}

                    {/* Inline UserRolesPanel */}
                    {selectedUser?.id === user.id && canManageUser(user) && (
                      <div className="border-border border-t px-3 py-3 sm:px-5">
                        <UserRolesPanel user={user} onClose={handleClosePanel} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
