import { useId, useState } from 'react'
import { Check, Info, Lock } from 'lucide-react'
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
import { CanDoArea, CanDoItem, CanDoNothing } from './CanDo'
import {
  BTN_GHOST_SM,
  BTN_PRIMARY_SM,
  OK_TEXT,
  SECTION_COUNT,
  SECTION_HEAD,
  TAG_ADD,
  TAG_REMOVE,
  WARN_TEXT,
} from './styles'
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
      sansTitle
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
  const rowId = useId()
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

  const tag = (r: RoleLike) => {
    if (diff.added.includes(r)) return <span className={TAG_ADD}>adding</span>
    if (diff.removed.includes(r)) return <span className={TAG_REMOVE}>removing</span>
    return null
  }

  const chips = (r: RoleLike) =>
    r.permissions.map((p) => (
      <span key={p} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10.5px]">
        {shortOf(p)}
      </span>
    ))

  /**
   * One role as a whole-row label (mock `.rrow`): tick, name and tag, holder
   * count; then its permissions and any note, all in the text column. The
   * checkbox is named by the role alone, so a note naming another role never
   * leaks into its name.
   */
  const roleRow = (r: RoleLike, testId: string, compact: boolean) => {
    const on = draftIds.has(r.id)
    const locked = lockedFor(r)
    const nameId = `${rowId}-${r.id}`
    const cover = on ? redundant.get(r.id) : undefined
    return (
      <label
        key={r.id}
        data-testid={testId}
        className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-[9px] gap-y-[3px] rounded-[10px] border px-2.5 py-[7px] ${
          on ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
        } ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          aria-labelledby={nameId}
          checked={on}
          disabled={locked}
          onChange={() => toggle(r)}
          className="accent-primary m-0"
        />
        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm">
          <span id={nameId} className="font-semibold">
            {r.name}
          </span>
          {tag(r)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {peopleLabel(roleHolders(r.id, data.users, data.held).length)}
        </span>
        {compact && !on ? (
          <span className="text-muted-foreground col-span-2 col-start-2 truncate text-xs">
            {plural(r.permissions.length, 'permission')}
            {r.permissions.length > 0 && `: ${r.permissions.map(shortOf).join(', ')}`}
          </span>
        ) : (
          <span className="col-span-2 col-start-2 flex flex-wrap gap-1">{chips(r)}</span>
        )}
        {locked && (
          <span className="text-muted-foreground col-span-2 col-start-2 flex items-center gap-[5px] text-xs">
            <Lock className="h-[13px] w-[13px] flex-shrink-0" />
            {ADMIN_ONLY_REASON}
          </span>
        )}
        {cover && cover.length > 0 && (
          <span className="col-span-2 col-start-2 flex items-start gap-[5px] text-xs leading-[1.35] text-amber-700 dark:text-amber-400">
            <Info className="mt-px h-[13px] w-[13px] flex-shrink-0" />
            <span>
              Adds nothing: {cover.map((c) => c.name).join(' and ')}{' '}
              {cover.length === 1 ? 'already grants' : 'already grant'} all of this.
            </span>
          </span>
        )}
      </label>
    )
  }

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
          <h4 className={SECTION_HEAD}>
            {first}&apos;s roles <span className={SECTION_COUNT}>{heldRoles.length}</span>
          </h4>
          {heldRoles.length === 0 ? (
            <p className="text-muted-foreground m-0 px-0.5 py-1 text-[12.5px]">
              No roles yet. They can sign in and see the shared screens only.
            </p>
          ) : (
            <div className="flex flex-col gap-[5px]">
              {heldRoles.map((r) => roleRow(r, `role-row-${r.id}`, false))}
            </div>
          )}
        </section>

        <section>
          <h4 className={SECTION_HEAD}>Add a role</h4>
          <div className="flex flex-col gap-[5px]">
            {addable.map((r) => roleRow(r, `add-role-${r.id}`, true))}
          </div>
        </section>

        <section data-testid="can-do">
          <h4 className={SECTION_HEAD}>
            What {first} can do
            {dirty && (
              <span className="font-medium tracking-normal normal-case"> after saving</span>
            )}
          </h4>
          {reg && shownCodes.size === 0 && <CanDoNothing />}
          {areas.map(({ area, items }) => (
            <CanDoArea key={area} area={area}>
              {items.map((p) => {
                const lost = diff.lost.has(p.codename)
                return (
                  <CanDoItem
                    key={p.codename}
                    short={p.short}
                    screens={p.screens}
                    via={grantedVia(p.codename, lost ? saved : draftRoles)
                      .map((r) => r.name)
                      .join(', ')}
                    state={lost ? 'lose' : diff.gained.has(p.codename) ? 'gain' : null}
                  />
                )
              })}
            </CanDoArea>
          ))}
          {adminOnly !== undefined && (
            <p className="text-muted-foreground mt-2 mb-0 flex items-start gap-1.5 text-xs">
              <Lock className="mt-px h-[13px] w-[13px] flex-shrink-0" />
              <span>Admin-only areas stay locked: {adminOnly}.</span>
            </p>
          )}
        </section>
      </div>

      <div data-testid="drawer-footer" className="border-border bg-card sticky bottom-0 border-t">
        {/* The tint sits on an inner layer: a translucent sticky background lets the list show through. */}
        <div className={`flex flex-col gap-2 px-4 py-2.5 ${dirty ? 'bg-primary/5' : ''}`}>
          <div className="text-muted-foreground text-[12.5px]">
            {dirty ? (
              <>
                {plural(changeLine.length, 'change')}:{' '}
                {changeLine.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && ' · '}
                    <b className={c.add ? OK_TEXT : WARN_TEXT}>{c.text}</b>
                  </span>
                ))}
              </>
            ) : (
              'No changes'
            )}
          </div>
          {save.isError && (
            <div className={`text-xs ${WARN_TEXT}`}>
              Couldn&apos;t save: {pbErrorText(save.error)}. Nothing was changed; your ticks are
              still here.
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={discard} disabled={!dirty} className={BTN_GHOST_SM}>
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || save.isPending}
              className={BTN_PRIMARY_SM}
            >
              <Check className="h-3.5 w-3.5" />
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
