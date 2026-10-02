import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, Pencil, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import type { RecordModel } from 'pocketbase'
import { pb } from '../../../lib/pocketbase'
import { queryKeys } from '../../../utils/queryKeys'
import { usePermissions } from '../../../hooks/usePermissions'
import { usePermissionDescriptions } from '../../../hooks/usePermissionDescriptions'
import { SlideInPanel } from '../../weekend/SlideInPanel'
import { mergeDescriptions, roleEditImpact, roleHolders, type UserLike } from './usersPageModel'
import { pbErrorText } from './pbErrorText'
import type { UsersPageProps } from './types'

interface RoleDrawerProps {
  /** null means creating a new role. */
  roleId: string | null
  data: UsersPageProps['data']
  registry: UsersPageProps['registry']
  url: UsersPageProps['url']
  onClose: () => void
  onCreated: (id: string) => void
}

interface RoleForm {
  name: string
  slug: string
  description: string
  permissions: string[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function namesOf(users: UserLike[]): string {
  const names = users.map((u) => u.name ?? u.email ?? '')
  return names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

const initials = (u: RecordModel) =>
  (str(u['name']) || str(u['email']))
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export function RoleDrawer({ roleId, data, registry, url, onClose, onCreated }: RoleDrawerProps) {
  const { isAdmin } = usePermissions()
  const role = roleId === null ? null : (data.roles.find((r) => r.id === roleId) ?? null)
  // Creating is admin-only; and an id that no longer resolves has nothing to show.
  if (roleId === null ? !isAdmin : !role) return null

  const holders = role ? roleHolders(role.id, data.users, data.held) : []
  const isNew = role === null
  return (
    <SlideInPanel
      identity={roleId ?? 'new'}
      title={isNew ? 'New role' : role.name}
      subtitle={
        isNew
          ? 'Admins only'
          : `${plural(role.permissions.length, 'permission')} · ${holders.length === 1 ? '1 person' : `${holders.length} people`}`
      }
      ariaLabel={isNew ? 'New role' : `Role ${role.name}`}
      testId="role-drawer"
      backdropTestId="role-drawer-backdrop"
      onClose={onClose}
    >
      <DrawerBody
        key={roleId ?? 'new'}
        roleId={roleId}
        data={data}
        registry={registry}
        url={url}
        onClose={onClose}
        onCreated={onCreated}
      />
    </SlideInPanel>
  )
}

function DrawerBody({ roleId, data, registry, url, onClose, onCreated }: RoleDrawerProps) {
  const { isAdmin } = usePermissions()
  const queryClient = useQueryClient()
  const reg = registry.data
  const role = roleId === null ? null : (data.roles.find((r) => r.id === roleId) ?? null)
  const isNew = role === null
  const overrides = usePermissionDescriptions().data

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [perms, setPerms] = useState<Set<string>>(new Set())
  const [slugTouched, setSlugTouched] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const invalidateRoles = () => queryClient.invalidateQueries({ queryKey: queryKeys.roles() })

  const saveMutation = useMutation({
    mutationFn: (form: RoleForm) =>
      role
        ? pb.collection('roles').update(role.id, form)
        : pb.collection('roles').create({ ...form, is_system: false }),
    onSuccess: async (rec) => {
      // Await the refetch: the drawer renders nothing until the new role is in data.roles.
      await invalidateRoles()
      if (role) setEditing(false)
      else onCreated(rec.id)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => pb.collection('roles').delete(id),
    onSuccess: () => {
      void invalidateRoles()
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRoles() })
      onClose()
    },
  })

  const holders = role ? roleHolders(role.id, data.users, data.held) : []
  const ownPerms = role?.permissions ?? []
  const merged = reg ? mergeDescriptions(reg.permissions, overrides ?? []) : []
  const shortOf = (code: string) => reg?.permissions.find((p) => p.codename === code)?.short ?? code
  const labelOf = (code: string) => reg?.permissions.find((p) => p.codename === code)?.label ?? code

  const startEdit = () => {
    if (!role) return
    setName(role.name)
    setSlug(role.slug)
    setDescription(str(role.description))
    setPerms(new Set(role.permissions))
    setConfirmDelete(false)
    saveMutation.reset()
    deleteMutation.reset()
    setEditing(true)
  }

  // ---- View mode ---------------------------------------------------------
  if (!isNew && !(editing && isAdmin)) {
    const areas = reg
      ? [...new Set([...reg.areas, ...reg.permissions.map((p) => p.area)])]
          .map((area) => ({
            area,
            items: reg.permissions.filter((p) => p.area === area && ownPerms.includes(p.codename)),
          }))
          .filter((a) => a.items.length > 0)
      : []
    return (
      <div className="space-y-4 p-4">
        <p className="m-0 text-sm leading-relaxed">{str(role.description)}</p>
        <section>
          <h4 className="mb-2 text-sm font-semibold">People</h4>
          {holders.length === 0 ? (
            <span className="text-muted-foreground text-xs">No one has this role.</span>
          ) : (
            <>
              <ul className="m-0 list-none space-y-1 p-0">
                {holders.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-xs">
                    <span className="bg-muted flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-semibold">
                      {initials(u)}
                    </span>
                    <span>{str(u['name']) || str(u['email'])}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="text-primary mt-2 text-xs"
                onClick={() => url.setRole(role.id)}
              >
                Show in Users
              </button>
            </>
          )}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-semibold">Permissions</h4>
          {reg ? (
            areas.map(({ area, items }) => (
              <div key={area} className="mb-2">
                <div className="text-muted-foreground text-[10.5px] font-bold uppercase">
                  {area}
                </div>
                {items.map((p) => (
                  <div key={p.codename} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <Check className="h-3 w-3" />
                    <span className="text-sm font-semibold">{p.short}</span>
                    {p.screens.map((s) => (
                      <Link
                        key={s.path}
                        to={s.path}
                        className="text-primary inline-flex items-center gap-0.5"
                      >
                        {s.name}
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="space-y-0.5">
              {ownPerms.map((code) => (
                <div key={code} className="flex items-center gap-2 text-xs">
                  <Check className="h-3 w-3" />
                  <span className="font-mono">{code}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={startEdit}>
            <Pencil className="h-4 w-4" />
            Edit role
          </button>
        )}
      </div>
    )
  }

  // ---- Editor (admins only; a null roleId was gated above) ----------------
  const added = [...perms].filter((c) => !ownPerms.includes(c))
  const removed = ownPerms.filter((c) => !perms.has(c))
  const metaChanged =
    !isNew && (name !== role.name || slug !== role.slug || description !== str(role.description))

  // Registry order; codenames the registry does not know are kept, never dropped.
  const universe = reg ? reg.permissions.map((p) => p.codename) : ownPerms
  const ordered = [
    ...universe.filter((c) => perms.has(c)),
    ...ownPerms.filter((c) => perms.has(c) && !universe.includes(c)),
  ]
  const orderedAdded = ordered.filter((c) => added.includes(c))
  const nChanges = added.length + removed.length + (metaChanged ? 1 : 0)
  const ok = isNew ? Boolean(name.trim() && slug.trim()) : nChanges > 0

  const impact = role
    ? roleEditImpact(
        role.id,
        ownPerms,
        ordered,
        holders.filter((u) => !u['is_admin']),
        data.held
      )
    : []
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many)

  const impactText = (line: (typeof impact)[number]) => {
    if (line.kind === 'gain') {
      return line.affected.length
        ? `${namesOf(line.affected)} ${verb(line.affected.length, 'gains', 'gain')} it`
        : 'nobody new; everyone with this role already has it'
    }
    const lose = line.affected.length
      ? `${namesOf(line.affected)} ${verb(line.affected.length, 'loses', 'lose')} it`
      : 'nobody loses it'
    return line.keep.length
      ? `${lose}; ${namesOf(line.keep)} ${verb(line.keep.length, 'keeps', 'keep')} it through another role`
      : lose
  }

  const summary = isNew ? (
    name.trim() && slug.trim() ? (
      `New role with ${plural(perms.size, 'permission')}`
    ) : (
      'Give it a name and slug'
    )
  ) : nChanges > 0 ? (
    <>
      {plural(nChanges, 'change')}:{' '}
      {[
        ...orderedAdded.map((c) => ({
          key: `+${c}`,
          text: `+ ${shortOf(c)}`,
          cls: 'text-emerald-600',
        })),
        ...removed.map((c) => ({ key: `-${c}`, text: `− ${shortOf(c)}`, cls: 'text-red-600' })),
        ...(metaChanged ? [{ key: 'meta', text: 'details', cls: '' }] : []),
      ].map((c, i) => (
        <span key={c.key} className={c.cls}>
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          {c.text}
        </span>
      ))}
    </>
  ) : (
    'No changes'
  )

  const toggle = (code: string) =>
    setPerms((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const onSave = () =>
    saveMutation.mutate({
      name: name.trim(),
      slug: slug.trim(),
      description,
      permissions: ordered,
    })

  const cancel = () => {
    if (isNew) onClose()
    else setEditing(false)
  }

  const rows = (codes: Array<{ code: string; short: string; desc: string }>) =>
    codes.map((p) => {
      const on = perms.has(p.code)
      const was = ownPerms.includes(p.code)
      return (
        <label
          key={p.code}
          className={`flex items-start gap-2 rounded px-1 py-1 text-xs ${on ? 'bg-primary/5' : ''}`}
        >
          <input type="checkbox" checked={on} onChange={() => toggle(p.code)} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{p.short}</span>
              {on !== was && (
                <span
                  className={`text-[10px] font-bold uppercase ${on ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {on ? 'adding' : 'removing'}
                </span>
              )}
              <span className="text-muted-foreground font-mono text-[10.5px]">{p.code}</span>
            </span>
            {p.desc && <span className="text-muted-foreground block">{p.desc}</span>}
          </span>
        </label>
      )
    })

  const error = saveMutation.error ?? deleteMutation.error
  const errorVerb = deleteMutation.error && !saveMutation.error ? 'delete' : 'save'
  const busy = saveMutation.isPending || deleteMutation.isPending
  const fieldCls = 'border-border bg-background w-full rounded-md border px-2 py-1 text-sm'

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4 p-4">
        {!isNew && (
          <p className="text-muted-foreground m-0 text-xs">
            {holders.length
              ? `${namesOf(holders)} ${verb(holders.length, 'holds', 'hold')} this role. The footer shows who gains or loses what before you save.`
              : 'Nobody holds this role yet.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium">
            Name
            <input
              className={fieldCls}
              value={name}
              placeholder="e.g. Office Staff"
              onChange={(e) => {
                setName(e.target.value)
                if (isNew && !slugTouched) setSlug(slugify(e.target.value))
              }}
            />
          </label>
          <div className="text-xs font-medium">
            <label>
              Slug
              <input
                className={`${fieldCls} font-mono`}
                value={slug}
                placeholder="health-center"
                disabled={Boolean(role?.is_system)}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
              />
            </label>
            {role?.is_system && (
              <span className="text-muted-foreground block font-normal">
                System roles keep their slug; code refers to it.
              </span>
            )}
          </div>
          <label className="col-span-2 text-xs font-medium">
            Description
            <textarea
              className={fieldCls}
              rows={2}
              value={description}
              placeholder="Who this role is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <section>
          <h4 className="mb-2 text-sm font-semibold">
            Permissions{' '}
            <span className="text-muted-foreground font-normal">
              {[...perms].filter((c) => universe.includes(c)).length} of {universe.length}
            </span>
          </h4>
          {reg
            ? [...new Set([...reg.areas, ...reg.permissions.map((p) => p.area)])].map((area) => {
                const items = merged.filter((m) => m.entry.area === area)
                if (items.length === 0) return null
                return (
                  <div key={area} className="mb-2">
                    <div className="text-muted-foreground text-[10.5px] font-bold uppercase">
                      {area}
                    </div>
                    {rows(
                      items.map((m) => ({
                        code: m.entry.codename,
                        short: m.entry.short,
                        desc: m.description,
                      }))
                    )}
                  </div>
                )
              })
            : rows(ownPerms.map((c) => ({ code: c, short: c, desc: '' })))}
        </section>

        {!isNew &&
          !role.is_system &&
          (confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 p-2 text-xs">
              <TriangleAlert className="h-4 w-4 text-red-600" />
              <span>
                Delete {role.name}?{' '}
                {holders.length ? `${namesOf(holders)} will lose it.` : 'Nobody holds it.'}
              </span>
              <button
                type="button"
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                onClick={() => deleteMutation.mutate(role.id)}
              >
                Delete role
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-1 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-red-600"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete this role
            </button>
          ))}
        {!isNew && role.is_system && (
          <p className="text-muted-foreground m-0 text-xs">
            System roles can be edited but not deleted.
          </p>
        )}
      </div>

      <div data-testid="role-footer" className="border-border bg-card sticky bottom-0 border-t">
        {/* The tint sits on an inner layer: a translucent sticky background lets the list show through. */}
        <div className={`space-y-2 p-3 ${ok ? 'bg-primary/5' : ''}`}>
          <div className="text-xs">{summary}</div>
          {impact.length > 0 && (
            <ul className="m-0 max-h-[140px] list-none space-y-1 overflow-y-auto p-0 text-xs">
              {impact.map((line) => (
                <li key={`${line.kind}${line.code}`} className="flex items-start gap-1">
                  {line.kind === 'gain' ? (
                    <Plus className="mt-0.5 h-3 w-3 text-emerald-600" />
                  ) : (
                    <span className="w-3 text-red-600">−</span>
                  )}
                  <span>
                    <b>{labelOf(line.code)}</b>: {impactText(line)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <div className="text-xs text-red-600">
              Couldn&apos;t {errorVerb}: {pbErrorText(error)}. Nothing was changed; your edits are
              still here.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancel} className="rounded-md border px-3 py-1 text-xs">
              {isNew ? 'Cancel' : 'Discard'}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!ok || busy}
              className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs disabled:opacity-50"
            >
              <ShieldCheck className="h-3 w-3" />
              {isNew ? 'Create role' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
