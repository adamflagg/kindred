import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Users as UsersIcon,
} from 'lucide-react'
import { pb } from '../../../lib/pocketbase'
import { queryKeys } from '../../../utils/queryKeys'
import { usePermissions } from '../../../hooks/usePermissions'
import { usePermissionDescriptions } from '../../../hooks/usePermissionDescriptions'
import { SlideInPanel } from '../../weekend/SlideInPanel'
import { mergeDescriptions, roleEditImpact, roleHolders, type UserLike } from './usersPageModel'
import { pbErrorText } from './pbErrorText'
import { UserAvatar } from './UserAvatar'
import { CanDoArea, CanDoItem } from './CanDo'
import {
  BTN_GHOST_SM,
  BTN_PRIMARY_MD,
  BTN_PRIMARY_SM,
  NOT_CHECKED_PILL,
  OK_TEXT,
  SECTION_COUNT,
  SECTION_HEAD,
  TAG_ADD,
  TAG_REMOVE,
  WARN_TEXT,
} from './styles'
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

export function RoleDrawer({ roleId, data, registry, url, onClose, onCreated }: RoleDrawerProps) {
  const { isAdmin } = usePermissions()
  // Lives here, not in the body, because the header says "Edit {role}" while editing.
  // A different role starts in view mode.
  const [editing, setEditing] = useState(false)
  const [shownId, setShownId] = useState(roleId)
  if (shownId !== roleId) {
    setShownId(roleId)
    setEditing(false)
  }
  const role = roleId === null ? null : (data.roles.find((r) => r.id === roleId) ?? null)
  // Creating is admin-only; and an id that no longer resolves has nothing to show.
  if (roleId === null ? !isAdmin : !role) return null

  const holders = role ? roleHolders(role.id, data.users, data.held) : []
  const isNew = role === null
  const inEditor = !isNew && editing && isAdmin
  const Icon = isNew ? Plus : inEditor ? Pencil : ShieldCheck
  return (
    <SlideInPanel
      identity={roleId ?? 'new'}
      title={isNew ? 'New role' : inEditor ? `Edit ${role.name}` : role.name}
      subtitle={
        isNew
          ? 'Admins only'
          : inEditor
            ? 'Changes apply to everyone who holds it, when you save'
            : `${plural(role.permissions.length, 'permission')} · ${holders.length === 1 ? '1 person' : `${holders.length} people`}`
      }
      leading={
        <span className="flex flex-shrink-0 rounded-lg bg-white/10 p-2">
          <Icon className="h-5 w-5 text-amber-400" />
        </span>
      }
      sansTitle
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
        editing={inEditor}
        setEditing={setEditing}
      />
    </SlideInPanel>
  )
}

function DrawerBody({
  roleId,
  data,
  registry,
  url,
  onClose,
  onCreated,
  editing,
  setEditing,
}: RoleDrawerProps & { editing: boolean; setEditing: (on: boolean) => void }) {
  const { isAdmin } = usePermissions()
  const queryClient = useQueryClient()
  const reg = registry.data
  const role = roleId === null ? null : (data.roles.find((r) => r.id === roleId) ?? null)
  const isNew = role === null
  const overrides = usePermissionDescriptions().data

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
  const unusedOf = (code: string) =>
    reg?.permissions.find((p) => p.codename === code)?.screens.length === 0

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
  if (!isNew && !editing) {
    const areas = reg
      ? [...new Set([...reg.areas, ...reg.permissions.map((p) => p.area)])]
          .map((area) => ({
            area,
            items: reg.permissions.filter((p) => p.area === area && ownPerms.includes(p.codename)),
          }))
          .filter((a) => a.items.length > 0)
      : []
    return (
      <div className="flex flex-col gap-5 p-4">
        {str(role.description) && (
          <p className="m-0 text-sm leading-relaxed">{str(role.description)}</p>
        )}
        <section>
          <h4 className={SECTION_HEAD}>People</h4>
          {holders.length === 0 ? (
            <span className="text-muted-foreground text-sm">No one has this role.</span>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {holders.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-sm">
                    <UserAvatar user={u} size={22} />
                    <span>{str(u['name']) || str(u['email'])}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${BTN_GHOST_SM} mt-1.5 -ml-2.5 !text-[13px]`}
                onClick={() => url.setRole(role.id)}
              >
                <UsersIcon className="h-4 w-4" />
                Show in Users
              </button>
            </>
          )}
        </section>
        <section>
          <h4 className={SECTION_HEAD}>Permissions</h4>
          {reg ? (
            areas.map(({ area, items }) => (
              <CanDoArea key={area} area={area}>
                {items.map((p) => (
                  <CanDoItem key={p.codename} short={p.short} screens={p.screens} />
                ))}
              </CanDoArea>
            ))
          ) : (
            <div className="space-y-0.5">
              {ownPerms.map((code) => (
                <div key={code} className="flex items-center gap-2 text-xs">
                  <Check className={`h-3 w-3 ${OK_TEXT}`} />
                  <span className="font-mono">{code}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        {isAdmin && (
          <button type="button" className={`${BTN_PRIMARY_MD} self-start`} onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" />
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
        ...orderedAdded.map((c) => ({ key: `+${c}`, text: `+ ${shortOf(c)}`, cls: OK_TEXT })),
        ...removed.map((c) => ({ key: `-${c}`, text: `− ${shortOf(c)}`, cls: WARN_TEXT })),
        ...(metaChanged ? [{ key: 'meta', text: 'details', cls: 'text-foreground' }] : []),
      ].map((c, i) => (
        <span key={c.key}>
          {i > 0 && ' · '}
          <b className={c.cls}>{c.text}</b>
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
          className={`hover:bg-muted flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${on ? 'bg-primary/6' : ''}`}
        >
          <input
            type="checkbox"
            checked={on}
            onChange={() => toggle(p.code)}
            className="accent-primary mt-0.5"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{p.short}</span>
              {on !== was && (
                <span className={on ? TAG_ADD : TAG_REMOVE}>{on ? 'adding' : 'removing'}</span>
              )}
              {unusedOf(p.code) && <span className={NOT_CHECKED_PILL}>not checked anywhere</span>}
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
      <div className="flex flex-1 flex-col gap-4 p-4">
        {!isNew && (
          <p className="text-muted-foreground m-0 text-[12.5px]">
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
                className={`${fieldCls} disabled:bg-muted disabled:text-muted-foreground font-mono`}
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
          <h4 className={SECTION_HEAD}>
            Permissions
            <span className={SECTION_COUNT}>
              {[...perms].filter((c) => universe.includes(c)).length} of {universe.length}
            </span>
          </h4>
          {reg
            ? [...new Set([...reg.areas, ...reg.permissions.map((p) => p.area)])].map((area) => {
                const items = merged.filter((m) => m.entry.area === area)
                if (items.length === 0) return null
                return (
                  <div key={area} className="mb-2">
                    <div className="text-muted-foreground mb-0.5 text-[10.5px] font-bold tracking-[0.06em] uppercase">
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
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-rose-100 p-2.5 text-[13px] dark:bg-rose-900/30">
              <TriangleAlert className={`h-4 w-4 ${WARN_TEXT}`} />
              <span>
                Delete {role.name}?{' '}
                {holders.length ? `${namesOf(holders)} will lose it.` : 'Nobody holds it.'}
              </span>
              <button
                type="button"
                disabled={busy}
                className={`${BTN_PRIMARY_SM} !bg-rose-700 !text-white dark:!bg-rose-300 dark:!text-rose-950`}
                onClick={() => deleteMutation.mutate(role.id)}
              >
                Delete role
              </button>
              <button
                type="button"
                className={BTN_GHOST_SM}
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`inline-flex items-center gap-1 self-start text-xs ${WARN_TEXT}`}
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
        <div className={`flex flex-col gap-2 px-4 py-2.5 ${ok ? 'bg-primary/5' : ''}`}>
          <div className="text-muted-foreground text-[12.5px]">{summary}</div>
          {impact.length > 0 && (
            <ul className="m-0 flex max-h-[140px] list-none flex-col gap-1 overflow-y-auto p-0 text-[12.5px]">
              {impact.map((line) => (
                <li key={`${line.kind}${line.code}`} className="flex items-start gap-1.5">
                  {line.kind === 'gain' ? (
                    <Plus className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${OK_TEXT}`} />
                  ) : (
                    <Minus className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${WARN_TEXT}`} />
                  )}
                  <span>
                    <b>{labelOf(line.code)}</b>: {impactText(line)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <div className={`text-xs ${WARN_TEXT}`}>
              Couldn&apos;t {errorVerb}: {pbErrorText(error)}. Nothing was changed; your edits are
              still here.
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={cancel} className={BTN_GHOST_SM}>
              {isNew ? 'Cancel' : 'Discard'}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!ok || busy}
              className={BTN_PRIMARY_SM}
            >
              <Check className="h-3.5 w-3.5" />
              {isNew ? 'Create role' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
