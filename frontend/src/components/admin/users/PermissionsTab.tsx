import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Pencil, RotateCcw, ShieldCheck } from 'lucide-react'
import { QueryGuard } from '../../QueryGuard'
import { usePermissions } from '../../../hooks/usePermissions'
import {
  usePermissionDescriptions,
  useSaveDescription,
} from '../../../hooks/usePermissionDescriptions'
import type { ApiPermissionRegistry } from '../../../types/api-types'
import {
  grantedVia,
  mergeDescriptions,
  overrideWriteFor,
  permissionHolders,
  type MergedPermission,
} from './usersPageModel'
import type { UsersPageProps } from './types'

const GRID = 'grid grid-cols-[200px_minmax(0,1fr)_260px] gap-3.5'
const TAG = 'rounded-full px-1.5 py-px text-[10.5px] font-medium'

type Entry = ApiPermissionRegistry['permissions'][number]

const peopleLabel = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** What each permission means in plain words, where to find it, who holds it (spec M1-M8). */
export function PermissionsTab(props: UsersPageProps) {
  const { registry } = props
  return (
    <QueryGuard
      isLoading={registry.isLoading}
      error={registry.error}
      data={registry.data}
      label="permissions"
    >
      {(reg) => <PermissionsBody {...props} reg={reg} />}
    </QueryGuard>
  )
}

function PermissionsBody({ data, url, reg }: UsersPageProps & { reg: ApiPermissionRegistry }) {
  const { isAdmin } = usePermissions()
  const overrides = usePermissionDescriptions()
  const save = useSaveDescription()
  // A failed overrides query shows the defaults and offers no editing at all.
  const canEdit = isAdmin && !overrides.isError
  const merged = mergeDescriptions(reg.permissions, overrides.data ?? [])

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [rowError, setRowError] = useState<{ code: string; msg: string } | null>(null)

  const boxRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState(240)

  useLayoutEffect(() => {
    const measure = () => {
      const top = boxRef.current?.getBoundingClientRect().top ?? 0
      const next = Math.max(240, window.innerHeight - top - 24)
      setMaxHeight((prev) => (prev === next ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // R10: reads `focus` only and never writes the URL.
  const focus = url.focus
  useEffect(() => {
    if (focus) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focus])

  const startEdit = (m: MergedPermission<Entry>) => {
    setEditing(m.entry.codename)
    setDraft(m.description)
    setRowError(null)
  }
  const commit = (m: MergedPermission<Entry>) => {
    const write = overrideWriteFor(m.entry, m.overrideId, draft)
    if (write.kind === 'none') {
      setEditing(null)
      return
    }
    setRowError(null)
    save.mutate(write, {
      onSuccess: () => setEditing(null),
      onError: (e: Error) =>
        setRowError({
          code: m.entry.codename,
          msg: `Couldn't save: ${e.message}. Your wording is still here.`,
        }),
    })
  }
  const reset = (m: MergedPermission<Entry>) => {
    if (!m.overrideId) return
    setRowError(null)
    save.mutate(
      { kind: 'delete', id: m.overrideId },
      {
        onError: (e: Error) =>
          setRowError({ code: m.entry.codename, msg: `Couldn't reset: ${e.message}.` }),
      }
    )
  }

  const areas = [...new Set([...reg.areas, ...reg.permissions.map((p) => p.area)])]
    .map((area) => ({ area, rows: merged.filter((m) => m.entry.area === area) }))
    .filter((g) => g.rows.length > 0)

  return (
    <div data-testid="permissions-tab" className="space-y-2.5">
      <div className="flex items-start gap-2 rounded-[10px] bg-purple-100/45 px-3 py-1.5 text-[13px] dark:bg-purple-900/20">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Admins can do everything</b>, plus these, which no permission grants:{' '}
          {reg.admin_only.join(', ')}.
        </span>
      </div>
      <div
        className={`${GRID} text-muted-foreground px-4 text-[11px] font-bold tracking-wider uppercase`}
      >
        <span>Permission</span>
        <span>What it lets someone do</span>
        <span>Granted by · people</span>
      </div>
      <div
        data-testid="perm-scroll"
        ref={boxRef}
        className="flex flex-col gap-2.5 overflow-y-auto pr-1"
        style={{ maxHeight }}
      >
        {areas.map(({ area, rows }) => (
          <div key={area} data-testid={`perm-area-${area}`}>
            <h3 className="bg-background text-muted-foreground sticky top-0 z-[2] py-1 text-[11px] font-bold tracking-wider uppercase">
              {area}
            </h3>
            <div className="bg-card divide-border divide-y rounded-xl border">
              {rows.map((m) => {
                const code = m.entry.codename
                const focused = focus === code
                const roles = grantedVia(code, data.roleLikes)
                const holders = permissionHolders(code, data.users, data.held)
                const isEditing = canEdit && editing === code
                return (
                  <div
                    key={code}
                    ref={focused ? focusRef : undefined}
                    data-testid={`perm-${code}`}
                    className={`${GRID} px-4 py-2.5 ${focused ? 'bg-primary/8 shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''}`}
                  >
                    <div>
                      <span className="font-semibold">{m.entry.short}</span>
                      <code className="text-muted-foreground block font-mono text-[11.5px]">
                        {code}
                      </code>
                      {m.entry.screens.length === 0 && (
                        <span
                          className={`${TAG} bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300`}
                        >
                          Not checked anywhere
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <textarea
                            rows={3}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="border-primary bg-background w-full rounded-md border px-2 py-1 text-[13px]"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={save.isPending}
                              onClick={() => commit(m)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded-md border px-3 py-1 text-xs"
                              onClick={() => {
                                setEditing(null)
                                setRowError(null)
                              }}
                            >
                              Cancel
                            </button>
                            <span className="text-muted-foreground text-[11.5px]">
                              Shown to everyone on this tab and in the user drawer.
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5 text-[13px]">
                          <span className="flex-1">{m.description}</span>
                          {canEdit && m.edited && (
                            <span className={`${TAG} bg-muted text-muted-foreground`}>Edited</span>
                          )}
                          {canEdit && m.defaultChanged && (
                            <span
                              className={`${TAG} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}
                            >
                              Default changed
                            </span>
                          )}
                          {canEdit && m.overrideId && (
                            <button
                              type="button"
                              aria-label="Reset to default"
                              disabled={save.isPending}
                              title="Reset to default"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => reset(m)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              aria-label="Edit description"
                              title="Edit description"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => startEdit(m)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {rowError?.code === code && (
                        <div className="mt-1 text-xs text-red-600">{rowError.msg}</div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-dashed pt-1.5">
                        <span className="text-muted-foreground text-[10.5px] font-bold tracking-wider uppercase">
                          Find it in
                        </span>
                        {m.entry.screens.length === 0 ? (
                          <span className="text-muted-foreground text-[12.5px] italic">
                            No screen yet
                          </span>
                        ) : (
                          m.entry.screens.map((s) => (
                            <Link
                              key={s.path}
                              to={s.path}
                              className="text-primary inline-flex items-center gap-0.5 text-[12.5px] font-medium hover:underline"
                            >
                              {s.name}
                              <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap content-start items-start gap-1">
                      {roles.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="bg-muted hover:bg-muted/70 rounded-full px-2 py-px text-[11.5px] font-medium"
                          onClick={() => url.setTab('roles')}
                        >
                          {r.name}
                        </button>
                      ))}
                      <span className="text-muted-foreground text-[12px] tabular-nums">
                        {peopleLabel(holders.length)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
