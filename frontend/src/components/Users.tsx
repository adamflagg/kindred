import { useState, useEffect } from 'react'
import { pb } from '../lib/pocketbase'
import { Users as UsersIcon, Mail, Calendar, Shield } from 'lucide-react'
import type { UsersResponse } from '../types/pocketbase-types'

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
    colors[Math.abs(hash) % colors.length] ||
    'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  )
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

export default function Users() {
  const [users, setUsers] = useState<UsersResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await pb.collection('users').getList<UsersResponse>(1, 1000, {
        sort: '-created',
        requestKey: null,
      })

      setUsers(result.items)
    } catch (err: unknown) {
      const error = err as { message?: string }
      if (error?.message?.includes('autocancelled')) {
        return
      }
      setError(error?.message || 'Failed to fetch users')
      setUsers([])
    } finally {
      setIsLoading(false)
    }
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
          {!isLoading && !error && (
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

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="spinner-lodge" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center sm:p-6 dark:border-red-800 dark:bg-red-950/30">
          <h2 className="font-display mb-2 text-base font-bold text-red-800 sm:text-lg dark:text-red-200">
            Error Loading Users
          </h2>
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchUsers} className="btn-primary">
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
          {users.map((user, index) => (
            <div
              key={user.id}
              className="hover:bg-muted/50 dark:hover:bg-muted/30 flex items-center gap-3 px-3 py-3 transition-colors sm:gap-4 sm:px-5 sm:py-4"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {/* Avatar */}
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full sm:h-11 sm:w-11 ${
                  user.avatar ? '' : getAvatarColor(user.email)
                }`}
              >
                {user.avatar ? (
                  <img
                    src={pb.files.getURL(user, user.avatar, { thumb: '44x44' })}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold sm:text-base">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* User Info */}
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-sm font-medium sm:text-base">
                  {user.name || user.email.split('@')[0]}
                </div>
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs sm:text-sm">
                  <Mail className="h-3 w-3 flex-shrink-0 sm:h-3.5 sm:w-3.5" />
                  <span className="truncate">{user.email}</span>
                </div>
              </div>

              {/* Join Date */}
              <div className="text-muted-foreground hidden flex-shrink-0 items-center gap-1.5 text-sm sm:flex">
                <Calendar className="h-3.5 w-3.5" />
                <span>{formatRelativeTime(user.created)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
