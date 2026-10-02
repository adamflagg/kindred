import { describe, expect, it } from 'vitest'
import {
  bucketCounts,
  bucketOf,
  draftDiff,
  effectivePermissions,
  filterUsers,
  freshness,
  grantedVia,
  mergeDescriptions,
  overrideWriteFor,
  pageOf,
  permissionHolders,
  redundantRoles,
  roleEditImpact,
  roleHolders,
  rolesByUser,
  type RoleLike,
  type UserLike,
} from './usersPageModel'

const exec: RoleLike = {
  id: 'r-exec',
  slug: 'exec',
  name: 'Executive',
  permissions: ['bunking.manage', 'metrics.geo', 'users.manage'],
}
const bunking: RoleLike = {
  id: 'r-bunk',
  slug: 'bunking-staff',
  name: 'Bunking Staff',
  permissions: ['bunking.manage'],
}
const finance: RoleLike = {
  id: 'r-fin',
  slug: 'finance',
  name: 'Finance',
  permissions: ['financial_aid.view', 'sheets.export'],
}
const roles = [exec, bunking, finance]

const admin: UserLike = {
  id: 'u-admin',
  is_admin: true,
  name: 'Riley Sam',
  email: 'riley@example.com',
}
const emma: UserLike = { id: 'u-emma', name: 'Emma Johnson', email: 'emma@example.com' }
const liam: UserLike = { id: 'u-liam', name: 'Liam Garcia', email: 'liam@example.com' }
const olivia: UserLike = { id: 'u-olivia', name: 'Olivia Chen', email: 'olivia@example.com' }
const users = [admin, emma, liam, olivia]
const links = [
  { id: 'l1', user: 'u-emma', role: 'r-exec' },
  { id: 'l2', user: 'u-emma', role: 'r-bunk' },
  { id: 'l3', user: 'u-liam', role: 'r-bunk' },
  { id: 'l4', user: 'u-admin', role: 'r-exec' },
  { id: 'l5', user: 'u-gone', role: 'r-exec' }, // orphan: user deleted
  { id: 'l6', user: 'u-olivia', role: 'r-deleted' }, // orphan: role deleted
]
const held = rolesByUser(users, links, roles)

describe('rolesByUser', () => {
  it('ignores links to missing users and roles', () => {
    expect(held.has('u-gone')).toBe(false)
    expect(held.get('u-olivia')).toEqual([])
    expect(held.get('u-emma')?.map((r) => r.slug)).toEqual(['exec', 'bunking-staff'])
  })
})

describe('buckets', () => {
  it('puts each person in exactly one bucket, admin first', () => {
    expect(bucketOf(admin, held.get('u-admin')!)).toBe('admin')
    expect(bucketOf(emma, held.get('u-emma')!)).toBe('exec')
    expect(bucketOf(liam, held.get('u-liam')!)).toBe('other')
    expect(bucketOf(olivia, held.get('u-olivia')!)).toBe('none')
  })
  it('counts sum to the total', () => {
    const c = bucketCounts(users, held)
    expect(c).toEqual({ all: 4, admin: 1, exec: 1, other: 1, none: 1 })
    expect(c.admin + c.exec + c.other + c.none).toBe(c.all)
  })
})

describe('filterUsers', () => {
  it('matches name or email, case-insensitively', () => {
    expect(filterUsers(users, held, { search: 'GARCIA', bucket: null, roleId: null })).toEqual([
      liam,
    ])
    expect(filterUsers(users, held, { search: 'olivia@', bucket: null, roleId: null })).toEqual([
      olivia,
    ])
  })
  it('combines bucket and specific role', () => {
    expect(filterUsers(users, held, { search: '', bucket: 'exec', roleId: null })).toEqual([emma])
    expect(filterUsers(users, held, { search: '', bucket: null, roleId: 'r-bunk' })).toEqual([
      emma,
      liam,
    ])
  })
})

describe('pageOf', () => {
  const items = Array.from({ length: 40 }, (_, i) => i)
  it('slices and reports pages', () => {
    expect(pageOf(items, 2, 15)).toMatchObject({ page: 2, pages: 3, start: 15 })
    expect(pageOf(items, 2, 15).items[0]).toBe(15)
  })
  it('clamps a page past the end (Review Focus 1)', () => {
    expect(pageOf(items.slice(0, 4), 3, 15)).toMatchObject({
      page: 1,
      pages: 1,
      start: 0,
      items: [0, 1, 2, 3],
    })
  })
  it('has one empty page for no items', () => {
    expect(pageOf([], 1, 15)).toMatchObject({ page: 1, pages: 1, start: 0, items: [] })
  })
})

describe('holders', () => {
  it('roleHolders includes admins who hold it; permissionHolders excludes admins', () => {
    expect(roleHolders('r-exec', users, held)).toEqual([admin, emma])
    expect(permissionHolders('bunking.manage', users, held)).toEqual([emma, liam])
  })
})

describe('effective permissions and attribution', () => {
  it('unions and attributes', () => {
    expect([...effectivePermissions([exec, finance])].sort()).toEqual(
      [
        'bunking.manage',
        'financial_aid.view',
        'metrics.geo',
        'sheets.export',
        'users.manage',
      ].sort()
    )
    expect(grantedVia('bunking.manage', [exec, bunking, finance])).toEqual([exec, bunking])
  })
  it('flags a role fully covered by the others', () => {
    const r = redundantRoles([exec, bunking])
    expect(r.get('r-bunk')).toEqual([exec])
    expect(r.has('r-exec')).toBe(false)
    expect(redundantRoles([bunking, finance]).size).toBe(0)
  })
})

describe('draftDiff', () => {
  it('reports role and permission changes', () => {
    const d = draftDiff([exec, bunking], [exec, finance])
    expect(d.added).toEqual([finance])
    expect(d.removed).toEqual([bunking])
    expect([...d.gained].sort()).toEqual(['financial_aid.view', 'sheets.export'])
    expect(d.lost.size).toBe(0) // bunking.manage still comes from Executive
  })
})

describe('roleEditImpact', () => {
  it('splits holders into lose vs keep, and gain vs already-had', () => {
    const holders = roleHolders('r-exec', users, held).filter((u) => !u.is_admin)
    const lines = roleEditImpact(
      'r-exec',
      exec.permissions,
      ['metrics.geo', 'users.manage', 'sheets.export'],
      holders,
      held
    )
    const lose = lines.find((l) => l.code === 'bunking.manage')!
    expect(lose.kind).toBe('lose')
    expect(lose.affected).toEqual([]) // Emma keeps it through Bunking Staff
    expect(lose.keep).toEqual([emma])
    const gain = lines.find((l) => l.code === 'sheets.export')!
    expect(gain).toMatchObject({ kind: 'gain', affected: [emma] })
  })
})

describe('freshness', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('bands by days', () => {
    expect(freshness('', now)).toBe('never')
    expect(freshness('2026-09-28 10:00:00.000Z', now)).toBe('fresh')
    expect(freshness('2026-09-01 10:00:00.000Z', now)).toBe('')
    expect(freshness('2026-07-01 10:00:00.000Z', now)).toBe('stale')
  })
})

describe('descriptions', () => {
  const entries = [
    { codename: 'metrics.geo', description: 'See and edit the geographic data behind the maps.' },
    {
      codename: 'sheets.export',
      description: 'Run the Google Sheets exports and see how they went.',
    },
  ]
  it('overrides win; default-changed compares the captured base; unknown codenames are ignored', () => {
    const merged = mergeDescriptions(entries, [
      {
        id: 'o1',
        codename: 'metrics.geo',
        description: 'Edited.',
        base_description: 'An older default.',
      },
      { id: 'o2', codename: 'retired.permission', description: 'Gone.', base_description: 'Gone.' },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      description: 'Edited.',
      edited: true,
      defaultChanged: true,
      overrideId: 'o1',
    })
    expect(merged[1]).toMatchObject({ edited: false, defaultChanged: false, overrideId: null })
  })
  it('turns an edit into the right write (Review Focus 2)', () => {
    const e = entries[0]!
    expect(overrideWriteFor(e, null, '  New wording. ')).toEqual({
      kind: 'create',
      codename: 'metrics.geo',
      description: 'New wording.',
      base_description: e.description,
    })
    expect(overrideWriteFor(e, 'o1', 'Again.')).toEqual({
      kind: 'update',
      id: 'o1',
      description: 'Again.',
      base_description: e.description,
    })
    expect(overrideWriteFor(e, 'o1', '   ')).toEqual({ kind: 'delete', id: 'o1' })
    expect(overrideWriteFor(e, 'o1', e.description)).toEqual({ kind: 'delete', id: 'o1' })
    expect(overrideWriteFor(e, null, e.description)).toEqual({ kind: 'none' })
  })
})
