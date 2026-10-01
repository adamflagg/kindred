import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { usePermissions } from '../../../hooks/usePermissions'
import { roleHolders } from './usersPageModel'
import { RoleDrawer } from './RoleDrawer'
import type { UsersPageProps } from './types'

const TH = 'px-2.5 py-[7px] border-b border-border align-bottom text-[12.5px] font-semibold'
const TD = 'px-2.5 py-[7px] border-b border-border text-center'
const PIN =
  'sticky left-0 text-left min-w-[250px] group-data-[scrolled=true]:shadow-[6px_0_8px_-6px_hsl(var(--shadow-color)/0.35)]'
const PILL =
  'ml-1.5 rounded-full px-1.5 py-px text-[10.5px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'

const peopleLabel = (n: number) => (n === 0 ? 'no one' : `${n} ${n === 1 ? 'person' : 'people'}`)

interface Row {
  code: string
  short: string
  unused: boolean
  /** False in the registry fallback, where the codename is the only label. */
  named: boolean
}

/** The permissions × roles grid (spec R1–R3, R5). */
export function RolesMatrix({ data, registry, url }: UsersPageProps) {
  const { isAdmin } = usePermissions()
  // undefined = closed, null = creating, string = editing that role
  const [drawer, setDrawer] = useState<string | null | undefined>(undefined)
  const [scrolled, setScrolled] = useState(false)

  const reg = registry.data
  const groups: Array<{ area: string | null; rows: Row[] }> = []
  if (reg) {
    const areas = [...reg.areas, ...reg.permissions.map((p) => p.area)]
    for (const area of [...new Set(areas)]) {
      const rows = reg.permissions
        .filter((p) => p.area === area)
        .map((p) => ({
          code: p.codename,
          short: p.short,
          unused: p.screens.length === 0,
          named: true,
        }))
      if (rows.length) groups.push({ area, rows })
    }
  } else {
    // Registry loading or failed (§6): bare codenames, under no area.
    const codes = [...new Set(data.roles.flatMap((r) => r.permissions))].sort()
    groups.push({
      area: null,
      rows: codes.map((code) => ({ code, short: code, unused: false, named: false })),
    })
  }

  const adminCount = data.users.filter((u) => Boolean(u['is_admin'])).length
  const colSpan = data.roles.length + 2
  const selected = drawer ?? null

  return (
    <div data-testid="roles-matrix">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          {data.roles.length} roles. Roles bundle permissions; a person can hold several. Only
          admins create or edit roles.
        </span>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setDrawer(null)}>
            <Plus className="h-4 w-4" />
            New role
          </button>
        )}
      </div>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <div
          data-testid="matrix-scroll"
          data-scrolled={scrolled}
          className="group overflow-x-auto"
          onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
        >
          <table className="w-full min-w-[900px] border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/55">
                <th className={`${TH} ${PIN} bg-muted z-10`}>Permission</th>
                <th className={`${TH} text-center`}>
                  <div className="flex flex-col items-center gap-[3px]">
                    Admin
                    <span className="text-muted-foreground text-[11.5px] font-medium tabular-nums">
                      {adminCount} {adminCount === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                </th>
                {data.roles.map((r) => {
                  const n = roleHolders(r.id, data.users, data.held).length
                  return (
                    <th
                      key={r.id}
                      className={`${TH} text-center ${selected === r.id ? 'bg-primary/8' : ''}`}
                    >
                      <div className="flex flex-col items-center gap-[3px]">
                        <button
                          type="button"
                          data-testid={`role-open-${r.id}`}
                          className="hover:text-primary font-semibold hover:underline"
                          onClick={() => setDrawer(r.id)}
                        >
                          {r.name}
                        </button>
                        {r.is_system && (
                          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
                            System
                          </span>
                        )}
                        <button
                          type="button"
                          data-testid={`role-count-${r.id}`}
                          disabled={n === 0}
                          className="text-muted-foreground enabled:hover:text-primary text-[11.5px] font-medium tabular-nums enabled:hover:underline"
                          onClick={() => url.setRole(r.id)}
                        >
                          {peopleLabel(n)}
                        </button>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g.area ?? 'all'}
                  group={g}
                  colSpan={colSpan}
                  data={data}
                  selected={selected}
                  onJump={(code) => url.setTab('permissions', code)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {drawer !== undefined && (
        <RoleDrawer
          roleId={drawer}
          data={data}
          registry={registry}
          onClose={() => setDrawer(undefined)}
        />
      )}
    </div>
  )
}

function GroupRows({
  group,
  colSpan,
  data,
  selected,
  onJump,
}: {
  group: { area: string | null; rows: Row[] }
  colSpan: number
  data: UsersPageProps['data']
  selected: string | null
  onJump: (code: string) => void
}) {
  return (
    <>
      {group.area && (
        <tr>
          <td
            colSpan={colSpan}
            className="border-border bg-muted/35 text-muted-foreground border-b px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase"
          >
            {group.area}
          </td>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={row.code}>
          <td data-testid={`matrix-pin-${row.code}`} className={`${TD} ${PIN} bg-card z-[1]`}>
            <button
              type="button"
              className={
                row.named
                  ? 'hover:text-primary font-semibold hover:underline'
                  : 'hover:text-primary font-mono text-[11px] hover:underline'
              }
              onClick={() => onJump(row.code)}
            >
              {row.short}
            </button>
            {row.unused && <span className={PILL}>not checked anywhere</span>}
            {row.named && (
              <span className="text-muted-foreground block font-mono text-[11px]">{row.code}</span>
            )}
          </td>
          <td className={TD}>
            <Check
              className="inline h-[17px] w-[17px] text-purple-700 dark:text-purple-400"
              strokeWidth={2.6}
            />
          </td>
          {data.roles.map((r) => (
            <td key={r.id} className={`${TD} ${selected === r.id ? 'bg-primary/8' : ''}`}>
              {r.permissions.includes(row.code) ? (
                <Check className="text-primary inline h-[17px] w-[17px]" strokeWidth={2.6} />
              ) : (
                <span className="text-border">·</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
