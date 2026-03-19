import { useNavigate } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { User as UserIcon, Mail, Activity, AlertTriangle, LogOut, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { pb } from '../lib/pocketbase'

function ProfileRow({
  icon,
  label,
  value,
  hasBorder = true,
  valueClassName = 'font-medium',
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hasBorder?: boolean
  valueClassName?: string
}) {
  return (
    <div className={hasBorder ? 'border-border border-b pb-4' : ''}>
      <div className="flex items-start gap-3">
        <div className="bg-muted flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className={valueClassName}>{value}</p>
        </div>
      </div>
    </div>
  )
}

export default function User() {
  const navigate = useNavigate()
  const { user, isLoading, error, isBypassMode, logout } = useAuth()

  const handleLogout = () => {
    logout()
    void navigate('/login')
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="border-primary h-12 w-12 animate-spin rounded-full border-b-2"></div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="bg-destructive/10 border-destructive/30 rounded-xl border p-6 text-center">
          <h2 className="font-display text-destructive mb-2 text-xl font-bold">
            Authentication Error
          </h2>
          <p className="text-muted-foreground">{error ?? 'Not authenticated'}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header Section */}
      <div className="card-lodge mb-6 p-4 sm:p-6">
        <h1 className="font-display flex items-center gap-3 text-2xl font-bold sm:text-3xl">
          <UserIcon className="text-primary h-6 w-6 sm:h-7 sm:w-7" />
          My Account
        </h1>
        <p className="text-muted-foreground mt-2">View and manage your profile information</p>
      </div>

      <div className="mx-auto max-w-3xl">
        {/* Main Profile Section */}
        <div className="space-y-6">
          {/* Profile Header Card */}
          <div className="card-lodge overflow-hidden">
            <div className="from-primary/10 to-primary/5 bg-gradient-to-br p-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="bg-background flex h-24 w-24 items-center justify-center overflow-hidden rounded-full shadow-lg">
                    {user['avatar'] ? (
                      <img
                        src={pb.files.getURL(user, user['avatar'])}
                        alt={user['name'] ?? user['email']}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserIcon className="text-primary h-12 w-12" />
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <h2 className="text-foreground text-2xl font-bold">
                    {user['name'] ?? user['email']}
                  </h2>
                  <p className="text-muted-foreground">{user['email']}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Account Details Card */}
          <div className="card-lodge p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <UserIcon className="text-primary h-5 w-5" />
              Account Information
            </h3>

            <div className="space-y-4">
              <ProfileRow
                icon={<Mail className="text-muted-foreground h-5 w-5" />}
                label="Email Address"
                value={user['email'] ?? 'No email address provided'}
              />
              <ProfileRow
                icon={<Activity className="text-muted-foreground h-5 w-5" />}
                label="Account Status"
                value="Active"
                valueClassName="text-primary font-medium"
              />
              <div data-testid="profile-last-login">
                <ProfileRow
                  icon={<Clock className="text-muted-foreground h-5 w-5" />}
                  label="Last Login"
                  value={
                    user['last_login']
                      ? formatDistanceToNow(new Date(user['last_login'] as string), {
                          addSuffix: true,
                        })
                      : 'Never'
                  }
                  hasBorder={false}
                />
              </div>
            </div>
          </div>

          {/* Bypass Mode Warning */}
          {isBypassMode && (
            <div className="bg-accent/20 border-accent/50 rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-accent mt-0.5 h-5 w-5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-accent-foreground font-medium">Bypass Mode Active</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Authentication is in bypass mode. User information may not reflect actual
                    authentication data.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sign Out Section */}
          <div className="card-lodge p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <LogOut className="text-muted-foreground h-5 w-5" />
                  Session
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Sign out of your account on this device
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-600 transition-all hover:border-red-300 hover:bg-red-100 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400 dark:hover:border-red-700/50 dark:hover:bg-red-900/30"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
