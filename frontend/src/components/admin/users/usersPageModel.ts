/**
 * Every count, filter and diff the Users page shows (spec 2026-10-01 §3.4, U5,
 * U10b–d, R4b, M6–M7). Pure: no React, no PocketBase.
 *
 * Counts join role links to the loaded people and roles, so an orphaned
 * user_roles row (prod has four) is never counted.
 */

export type Bucket = 'admin' | 'exec' | 'other' | 'none'
export const EXEC_SLUG = 'exec'

export interface UserLike {
  id: string
  is_admin?: boolean
  name?: string
  email?: string
}
export interface RoleLike {
  id: string
  slug: string
  name: string
  permissions: string[]
}
export interface UserRoleLike {
  id: string
  user: string
  role: string
}

export function rolesByUser(
  users: UserLike[],
  userRoles: UserRoleLike[],
  roles: RoleLike[]
): Map<string, RoleLike[]> {
  const roleById = new Map(roles.map((r) => [r.id, r]))
  const out = new Map<string, RoleLike[]>(users.map((u) => [u.id, []]))
  for (const link of userRoles) {
    const list = out.get(link.user)
    const role = roleById.get(link.role)
    if (list && role && !list.includes(role)) list.push(role)
  }
  return out
}

export function bucketOf(user: UserLike, held: RoleLike[]): Bucket {
  if (user.is_admin) return 'admin'
  if (held.length === 0) return 'none'
  return held.some((r) => r.slug === EXEC_SLUG) ? 'exec' : 'other'
}

export function bucketCounts(
  users: UserLike[],
  held: Map<string, RoleLike[]>
): Record<Bucket | 'all', number> {
  const c = { all: users.length, admin: 0, exec: 0, other: 0, none: 0 }
  for (const u of users) c[bucketOf(u, held.get(u.id) ?? [])] += 1
  return c
}

export function filterUsers<U extends UserLike>(
  users: U[],
  held: Map<string, RoleLike[]>,
  f: { search: string; bucket: Bucket | null; roleId: string | null }
): U[] {
  const q = f.search.trim().toLowerCase()
  return users.filter((u) => {
    const mine = held.get(u.id) ?? []
    if (q && !`${u.name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q)) return false
    if (f.bucket && bucketOf(u, mine) !== f.bucket) return false
    if (f.roleId && !mine.some((r) => r.id === f.roleId)) return false
    return true
  })
}

export function pageOf<T>(items: T[], page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * perPage
  return { items: items.slice(start, start + perPage), page: current, pages, start }
}

export function roleHolders<U extends UserLike>(
  roleId: string,
  users: U[],
  held: Map<string, RoleLike[]>
): U[] {
  return users.filter((u) => (held.get(u.id) ?? []).some((r) => r.id === roleId))
}

export function permissionHolders<U extends UserLike>(
  code: string,
  users: U[],
  held: Map<string, RoleLike[]>
): U[] {
  return users.filter(
    (u) => !u.is_admin && (held.get(u.id) ?? []).some((r) => r.permissions.includes(code))
  )
}

export function effectivePermissions(roles: RoleLike[]): Set<string> {
  return new Set(roles.flatMap((r) => r.permissions))
}

export function grantedVia(code: string, roles: RoleLike[]): RoleLike[] {
  return roles.filter((r) => r.permissions.includes(code))
}

/** Roles that add nothing, mapped to the other roles that cover them (U10c). */
export function redundantRoles(roles: RoleLike[]): Map<string, RoleLike[]> {
  const out = new Map<string, RoleLike[]>()
  for (const role of roles) {
    if (role.permissions.length === 0) continue
    const others = roles.filter((r) => r.id !== role.id)
    const cover = effectivePermissions(others)
    if (role.permissions.every((p) => cover.has(p))) {
      out.set(
        role.id,
        others.filter((o) => o.permissions.some((p) => role.permissions.includes(p)))
      )
    }
  }
  return out
}

export function draftDiff(saved: RoleLike[], draft: RoleLike[]) {
  const before = effectivePermissions(saved)
  const after = effectivePermissions(draft)
  return {
    added: draft.filter((r) => !saved.includes(r)),
    removed: saved.filter((r) => !draft.includes(r)),
    gained: new Set([...after].filter((p) => !before.has(p))),
    lost: new Set([...before].filter((p) => !after.has(p))),
  }
}

export interface ImpactLine {
  code: string
  kind: 'gain' | 'lose'
  affected: UserLike[]
  keep: UserLike[]
}

/** Who actually gains or loses each permission an edit to one role changes (R4b). */
export function roleEditImpact(
  roleId: string,
  current: string[],
  next: string[],
  holders: UserLike[],
  held: Map<string, RoleLike[]>
): ImpactLine[] {
  const viaOther = (u: UserLike, code: string) =>
    (held.get(u.id) ?? []).some((r) => r.id !== roleId && r.permissions.includes(code))
  const lines: ImpactLine[] = []
  for (const code of next.filter((c) => !current.includes(c))) {
    lines.push({
      code,
      kind: 'gain',
      affected: holders.filter((u) => !viaOther(u, code)),
      keep: [],
    })
  }
  for (const code of current.filter((c) => !next.includes(c))) {
    lines.push({
      code,
      kind: 'lose',
      affected: holders.filter((u) => !viaOther(u, code)),
      keep: holders.filter((u) => viaOther(u, code)),
    })
  }
  return lines
}

export type Freshness = 'fresh' | 'stale' | 'never' | ''
const DAY = 86_400_000

/** U8: green within 7 days, amber past 45, hollow when never seen. */
export function freshness(lastSeen: string, now: Date): Freshness {
  if (!lastSeen) return 'never'
  const days = (now.getTime() - new Date(lastSeen.replace(' ', 'T')).getTime()) / DAY
  if (days <= 7) return 'fresh'
  if (days > 45) return 'stale'
  return ''
}

export interface RegistryEntry {
  codename: string
  description: string
}
export interface OverrideRow {
  id: string
  codename: string
  description: string
  base_description: string
}
export interface MergedPermission<E extends RegistryEntry> {
  entry: E
  description: string
  overrideId: string | null
  edited: boolean
  defaultChanged: boolean
}

export function mergeDescriptions<E extends RegistryEntry>(
  entries: E[],
  overrides: OverrideRow[]
): Array<MergedPermission<E>> {
  const byCode = new Map(overrides.map((o) => [o.codename, o]))
  return entries.map((entry) => {
    const o = byCode.get(entry.codename)
    return o
      ? {
          entry,
          description: o.description,
          overrideId: o.id,
          edited: true,
          defaultChanged: o.base_description !== entry.description,
        }
      : {
          entry,
          description: entry.description,
          overrideId: null,
          edited: false,
          defaultChanged: false,
        }
  })
}

export type OverrideWrite =
  | { kind: 'create'; codename: string; description: string; base_description: string }
  | { kind: 'update'; id: string; description: string; base_description: string }
  | { kind: 'delete'; id: string }
  | { kind: 'none' }

/** Blank, or equal to the default, removes the override (Review Focus 2). */
export function overrideWriteFor(
  entry: RegistryEntry,
  existingId: string | null,
  text: string
): OverrideWrite {
  const t = text.trim()
  if (!t || t === entry.description)
    return existingId ? { kind: 'delete', id: existingId } : { kind: 'none' }
  return existingId
    ? { kind: 'update', id: existingId, description: t, base_description: entry.description }
    : {
        kind: 'create',
        codename: entry.codename,
        description: t,
        base_description: entry.description,
      }
}
