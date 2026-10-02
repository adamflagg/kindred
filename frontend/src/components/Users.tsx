import { Users as UsersIcon, ShieldCheck, KeyRound, Shield } from 'lucide-react'
import { QueryGuard } from './QueryGuard'
import { usePermissionRegistry } from '../hooks/usePermissionRegistry'
import { useUsersPageUrl, type UsersTab } from './admin/users/useUsersPageUrl'
import { useUsersPageData } from './admin/users/useUsersPageData'
import { UsersTable } from './admin/users/UsersTable'
import { RolesMatrix } from './admin/users/RolesMatrix'
import { PermissionsTab } from './admin/users/PermissionsTab'

const TAB_BASE =
  'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors'
const TAB_ON = 'bg-white text-forest-800 shadow-sm'
const TAB_OFF = 'text-forest-200 hover:bg-white/10'

/** System Access (spec 2026-10-01 P1): the forest band holds the title and the three tabs. */
export default function Users() {
  const url = useUsersPageUrl()
  const data = useUsersPageData()
  const registry = usePermissionRegistry()
  const tabs: Array<[UsersTab, typeof UsersIcon, string, number | undefined]> = [
    ['users', UsersIcon, 'Users', data.isLoading ? undefined : data.users.length],
    ['roles', ShieldCheck, 'Roles', data.isLoading ? undefined : data.roles.length],
    ['permissions', KeyRound, 'Permissions', registry.data?.total],
  ]
  return (
    <div className="space-y-3.5">
      <div className="from-forest-700 to-forest-800 flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-r py-3 pr-3.5 pl-4.5">
        <div className="mr-auto flex items-center gap-3">
          <div className="rounded-lg bg-white/10 p-1.5">
            <Shield className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-white">System Access</h1>
            <p className="text-forest-200 text-sm">
              Who can sign in, and what each role lets them do
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map(([id, Icon, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => url.setTab(id)}
              className={`${TAB_BASE} ${url.tab === id ? TAB_ON : TAB_OFF}`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {count !== undefined && (
                <span className="font-medium tabular-nums opacity-75">{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <QueryGuard
        isLoading={data.isLoading}
        error={data.error}
        data={data.isLoading ? undefined : data}
        label="access"
      >
        {(d) =>
          url.tab === 'roles' ? (
            <RolesMatrix data={d} registry={registry} url={url} />
          ) : url.tab === 'permissions' ? (
            <PermissionsTab data={d} registry={registry} url={url} />
          ) : (
            <UsersTable data={d} registry={registry} url={url} />
          )
        }
      </QueryGuard>
    </div>
  )
}
