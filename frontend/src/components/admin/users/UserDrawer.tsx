import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Check, Minus } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import type { RecordModel } from 'pocketbase'
import { usePermissions } from '../../../hooks/usePermissions'
import { Permission } from '../../../constants/permissions'
import { UserAvatar } from './UserAvatar'
import { SlideInPanel } from '../../weekend/SlideInPanel'
import {
  draftDiff,
  effectivePermissions,
  grantedVia,
  redundantRoles,
  roleHolders,
  type RoleLike,
} from './usersPageModel'
import { useSaveUserRoles } from './useSaveUserRoles'
import { pbErrorText } from './pbErrorText'
import type { UsersPageProps } from './types'

interface UserDrawerProps {
  user: RecordModel
  data: UsersPageProps['data']
  registry: UsersPageProps['registry']
  onClose: () => void
}

const NO_ROLES: RoleLike[] = []
const ADMIN_ONLY_REASON = 'Only admins can give or remove user management'

const parseDate = (s: string) => new Date(s.replace(' ', 'T'))
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const firstNonEmpty = (...xs: Array<string | undefined>) => xs.find((x) => x) ?? ''
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const peopleLabel = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

export function UserDrawer({ user, data, registry, onClose }: UserDrawerProps) {
  const saved = data.held.get(user.id) ?? NO_ROLES
  const first = firstNonEmpty(str(user['name']).split(' ')[0], str(user['email']), 'This person')
  const perms = effectivePermissions(saved).size
  const summary = saved.length
    ? `${saved.map((r) => r.name).join(' · ')} — ${plural(perms, 'permission')}`
    : 'No roles'

  return (
    <SlideInPanel
      identity={user.id}
      title={str(user['name']) || str(user['email'])}
      subtitle={
        <>
          <div>{str(user['email'])}</div>
          <div>{summary}</div>
        </>
      }
      leading={<UserAvatar user={user} size={40} />}
      ariaLabel="Manage roles"
      testId="user-drawer"
      backdropTestId="user-drawer-backdrop"
      onClose={onClose}
    >
      {/* Keyed by person: the draft starts over when the drawer switches people. */}
      <DrawerBody
        key={user.id}
        user={user}
        first={first}
        saved={saved}
        data={data}
        registry={registry}
      />
    </SlideInPanel>
  )
}

function DrawerBody({
  user,
  first,
  saved: heldSaved,
  data,
  registry,
}: Omit<UserDrawerProps, 'onClose'> & { first: string; saved: RoleLike[] }) {
  const { isAdmin } = usePermissions()
  const save = useSaveUserRoles()
  const reg = registry.data

  // After a save the refetched links arrive a beat later; until they do, the
  // roles we just wrote stand in as the saved set.
  const [override, setOverride] = useState<{ base: RoleLike[]; roles: RoleLike[] } | null>(null)
  const saved = override?.base === heldSaved ? override.roles : heldSaved

  const [draftIds, setDraftIds] = useState<Set<string>>(() => new Set(heldSaved.map((r) => r.id)))

  // Built from data.roleLikes so draftDiff's by-reference comparison holds.
  const draftRoles = data.roleLikes.filter((r) => draftIds.has(r.id))
  const diff = draftDiff(saved, draftRoles)
  const dirty = diff.added.length + diff.removed.length > 0
  const redundant = redundantRoles(draftRoles)

  const shortOf = (code: string) => reg?.permissions.find((p) => p.codename === code)?.short ?? code
  const lockedFor = (r: RoleLike) => !isAdmin && r.permissions.includes(Permission.USERS_MANAGE)

  const toggle = (r: RoleLike) => {
    if (lockedFor(r)) return
    setDraftIds((prev) => {
      const next = new Set(prev)
      if (next.has(r.id)) next.delete(r.id)
      else next.add(r.id)
      return next
    })
  }

  const discard = () => {
    setDraftIds(new Set(saved.map((r) => r.id)))
    save.reset()
  }

  const onSave = () => {
    const removed = new Set(diff.removed.map((r) => r.id))
    const remove = data.userRoles
      .filter((l) => l.user === user.id && removed.has(l.role))
      .map((l) => l.id)
    save.mutate(
      { userId: user.id, add: diff.added.map((r) => r.id), remove },
      {
        onSuccess: () => {
          setOverride({ base: heldSaved, roles: draftRoles })
        },
      }
    )
  }

  const redundantNote = (r: RoleLike) => {
    const cover = redundant.get(r.id)
    if (!cover || cover.length === 0 || !draftIds.has(r.id)) return null
    return (
      <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
        Adds nothing: {cover.map((c) => c.name).join(' and ')}{' '}
        {cover.length === 1 ? 'already grants' : 'already grant'} all of this.
      </div>
    )
  }

  const chips = (r: RoleLike) =>
    r.permissions.map((p) => (
      <span key={p} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10.5px]">
        {shortOf(p)}
      </span>
    ))

  const tag = (r: RoleLike) => {
    if (diff.added.includes(r))
      return <span className="text-[10px] font-bold text-emerald-600 uppercase">adding</span>
    if (diff.removed.includes(r))
      return <span className="text-[10px] font-bold text-red-600 uppercase">removing</span>
    return null
  }

  const checkbox = (r: RoleLike) => (
    <input
      type="checkbox"
      checked={draftIds.has(r.id)}
      disabled={lockedFor(r)}
      onChange={() => toggle(r)}
      className="mt-0.5"
    />
  )

  const lockNote = (r: RoleLike) =>
    lockedFor(r) ? (
      <div className="text-muted-foreground text-[11px]">{ADMIN_ONLY_REASON}</div>
    ) : null

  const lastSeen = str(user['last_seen'])
  const lastLogin = str(user['last_login'])
  const created = str(user['created'])
  const facts = [
    lastSeen
      ? `Active ${formatDistanceToNow(parseDate(lastSeen), { addSuffix: true })}`
      : 'Never active',
    lastLogin ? `signed in via Pocket ID ${format(parseDate(lastLogin), 'MMM d, yyyy')}` : '',
    created ? `joined ${format(parseDate(created), 'MMM d, yyyy')}` : '',
  ].filter(Boolean)

  const heldRoles = saved
  const addable = data.roleLikes.filter((r) => !saved.includes(r))

  // What they can do: the union of saved and draft, grouped by registry area.
  const shownCodes = new Set([...effectivePermissions(saved), ...effectivePermissions(draftRoles)])
  const areas = reg
    ? reg.areas
        .map((area) => ({
          area,
          items: reg.permissions.filter((p) => p.area === area && shownCodes.has(p.codename)),
        }))
        .filter((a) => a.items.length > 0)
    : []
  const adminOnly = reg?.admin_only.map((s) => s.split(' (')[0]).join(', ')

  const changeLine = [
    ...diff.added.map((r) => ({ key: `+${r.id}`, text: `+ ${r.name}`, add: true })),
    ...diff.removed.map((r) => ({ key: `-${r.id}`, text: `− ${r.name}`, add: false })),
  ]

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4 p-4">
        <p data-testid="drawer-facts" className="text-muted-foreground text-xs">
          {facts.join(' · ')}
        </p>

        <section>
          <h4 className="mb-2 text-sm font-semibold">
            {first}&apos;s roles{' '}
            <span className="text-muted-foreground font-normal">{heldRoles.length}</span>
          </h4>
          {heldRoles.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No roles yet. They can sign in and see the shared screens only.
            </p>
          ) : (
            <div className="space-y-2">
              {heldRoles.map((r) => {
                return (
                  <div
                    key={r.id}
                    data-testid={`role-row-${r.id}`}
                    className="border-border rounded-md border p-2"
                  >
                    <label className="flex items-start gap-2">
                      {checkbox(r)}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{r.name}</span>
                          <span className="text-muted-foreground text-[11px]">
                            {peopleLabel(roleHolders(r.id, data.users, data.held).length)}
                          </span>
                          {tag(r)}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">{chips(r)}</span>
                      </span>
                    </label>
                    {lockNote(r)}
                    {redundantNote(r)}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">Add a role</h4>
          <div className="space-y-1">
            {addable.map((r) => {
              const on = draftIds.has(r.id)
              return (
                <div
                  key={r.id}
                  data-testid={`add-role-${r.id}`}
                  className="border-border rounded-md border p-2"
                >
                  <label className="flex items-start gap-2">
                    {checkbox(r)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.name}</span>
                        {tag(r)}
                      </span>
                      {on ? (
                        <span className="mt-1 flex flex-wrap gap-1">{chips(r)}</span>
                      ) : (
                        <span className="text-muted-foreground block truncate text-[11px]">
                          {plural(r.permissions.length, 'permission')}
                          {r.permissions.length > 0 && `: ${r.permissions.map(shortOf).join(', ')}`}
                        </span>
                      )}
                    </span>
                  </label>
                  {lockNote(r)}
                  {redundantNote(r)}
                </div>
              )
            })}
          </div>
        </section>

        <section data-testid="can-do">
          <h4 className="mb-2 text-sm font-semibold">
            What {first} can do
            {dirty && <span className="text-muted-foreground font-normal"> after saving</span>}
          </h4>
          {areas.map(({ area, items }) => (
            <div key={area} className="mb-2.5">
              <div className="text-muted-foreground mb-1 block text-[10.5px] font-bold tracking-[0.06em] uppercase">
                {area}
              </div>
              <ul className="flex flex-col gap-1.5">
                {items.map((p) => {
                  const lost = diff.lost.has(p.codename)
                  const gained = diff.gained.has(p.codename)
                  const via = grantedVia(p.codename, lost ? saved : draftRoles)
                  const Icon = lost ? Minus : Check
                  return (
                    <li
                      key={p.codename}
                      className={`flex items-start gap-2 text-sm leading-[1.4] ${lost ? 'text-muted-foreground' : ''}`}
                    >
                      <Icon
                        className={`mt-0.5 h-[15px] w-[15px] flex-shrink-0 ${lost ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                      />
                      <span className="min-w-0">
                        <span className={`font-semibold ${lost ? 'line-through' : ''}`}>
                          {p.short}
                        </span>
                        {gained && (
                          <span className="ml-1.5 rounded bg-emerald-600/15 px-1.5 text-[10px] leading-4 font-bold text-emerald-700 uppercase dark:text-emerald-400">
                            new
                          </span>
                        )}
                        {lost && (
                          <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 text-[10px] leading-4 font-bold text-amber-700 uppercase dark:text-amber-400">
                            removed
                          </span>
                        )}
                        <span className="text-muted-foreground block text-xs">
                          via {via.map((r) => r.name).join(', ')}
                        </span>
                        {p.screens.length > 0 && (
                          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                            {p.screens.map((s) => (
                              <Link
                                key={s.path}
                                to={s.path}
                                className="text-primary inline-flex items-center gap-[3px] text-[12.5px] font-medium whitespace-nowrap hover:underline"
                              >
                                <ArrowUpRight className="h-[13px] w-[13px]" />
                                {s.name}
                              </Link>
                            ))}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {adminOnly !== undefined && (
            <p className="text-muted-foreground mt-2 text-[11px]">
              Admin-only areas stay locked: {adminOnly}.
            </p>
          )}
        </section>
      </div>

      <div data-testid="drawer-footer" className="border-border bg-card sticky bottom-0 border-t">
        {/* The tint sits on an inner layer: a translucent sticky background lets the list show through. */}
        <div className={`space-y-2 p-3 ${dirty ? 'bg-primary/5' : ''}`}>
          <div className="text-xs">
            {dirty ? (
              <>
                {plural(changeLine.length, 'change')}:{' '}
                {changeLine.map((c, i) => (
                  <span key={c.key} className={c.add ? 'text-emerald-600' : 'text-red-600'}>
                    {i > 0 && <span className="text-muted-foreground"> · </span>}
                    {c.text}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-muted-foreground">No changes</span>
            )}
          </div>
          {save.isError && (
            <div className="text-xs text-red-600">
              Couldn&apos;t save: {pbErrorText(save.error)}. Nothing was changed; your ticks are
              still here.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={!dirty}
              className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || save.isPending}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-xs disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
