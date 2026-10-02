import { vi } from 'vitest'
import type { RecordModel } from 'pocketbase'
import type { Role, UserRole } from '../../../types/rbac'
import type { ApiPermissionRegistry } from '../../../types/api-types'
import { rolesByUser } from './usersPageModel'
import type { UsersPageProps } from './types'

const rec = (o: Record<string, unknown>) =>
  ({ collectionId: 'users', collectionName: 'users', ...o }) as unknown as RecordModel
const role = (id: string, slug: string, name: string, permissions: string[], is_system: boolean) =>
  ({ id, slug, name, permissions, is_system, description: `${name} access` }) as unknown as Role

export const ROLES: Role[] = [
  role('r-exec', 'exec', 'Executive', ['bunking.manage', 'metrics.geo', 'users.manage'], false),
  role('r-bunk', 'bunking-staff', 'Bunking Staff', ['bunking.manage'], true),
  role('r-fin', 'finance', 'Finance', ['financial_aid.view', 'sheets.export'], false),
  role('r-empty', 'hiring-team', 'Hiring Team', ['staff.hiring'], false),
]
export const USERS: RecordModel[] = [
  rec({
    id: 'u-admin',
    name: 'Riley Sam',
    email: 'riley@example.com',
    is_admin: true,
    created: '2026-05-02 10:00:00.000Z',
    last_seen: '2026-09-30 10:00:00.000Z',
    last_login: '2026-05-02 10:00:00.000Z',
  }),
  rec({
    id: 'u-emma',
    name: 'Emma Johnson',
    email: 'emma@example.com',
    created: '2026-05-03 10:00:00.000Z',
    last_seen: '2026-09-29 10:00:00.000Z',
    last_login: '2026-05-03 10:00:00.000Z',
  }),
  rec({
    id: 'u-liam',
    name: 'Liam Garcia',
    email: 'liam@example.com',
    created: '2026-06-10 10:00:00.000Z',
    last_seen: '2026-07-01 10:00:00.000Z',
    last_login: '2026-06-10 10:00:00.000Z',
  }),
  rec({
    id: 'u-olivia',
    name: 'Olivia Chen',
    email: 'olivia@example.com',
    created: '2026-07-08 10:00:00.000Z',
    last_seen: '',
    last_login: '',
  }),
  ...Array.from({ length: 16 }, (_, i) =>
    rec({
      id: `u-p${i + 1}`,
      name: `Person ${String(i + 1).padStart(2, '0')}`,
      email: `person${i + 1}@example.com`,
      created: '2026-05-10 10:00:00.000Z',
      last_seen: '',
      last_login: '',
    })
  ),
]
export const LINKS: UserRole[] = [
  { id: 'l1', user: 'u-emma', role: 'r-exec' },
  { id: 'l2', user: 'u-emma', role: 'r-bunk' },
  { id: 'l3', user: 'u-liam', role: 'r-bunk' },
  { id: 'l4', user: 'u-admin', role: 'r-exec' },
  { id: 'l5', user: 'u-gone', role: 'r-exec' }, // orphan: user deleted
].map((l) => l as unknown as UserRole)

const perm = (
  codename: string,
  label: string,
  short: string,
  area: string,
  screens: Array<{ name: string; path: string }>,
  description: string
) => ({ codename, label, short, area, screens, description })
/** In API order: area, then registry order (Task 2). */
export const REGISTRY: ApiPermissionRegistry = {
  permissions: [
    perm(
      'bunking.manage',
      'Bunking and housing',
      'Bunking and housing',
      'Summer and Weekend',
      [{ name: 'Summer board', path: '/summer/sessions' }],
      'Place campers and families.'
    ),
    perm(
      'financial_aid.view',
      'Camperships: family detail',
      'Family detail',
      'Camperships',
      [{ name: 'Camperships', path: '/aid' }],
      "See each family's aid."
    ),
    perm(
      'metrics.financial',
      'Financial projections',
      'Financial projections',
      'Analytics',
      [],
      'Nothing yet.'
    ),
    perm(
      'metrics.geo',
      'Geographic data',
      'Geographic data',
      'Analytics',
      [{ name: 'Manage › Geo Data', path: '/manage/geo' }],
      'See and edit the geographic data behind the maps.'
    ),
    perm(
      'staff.hiring',
      'Staff retention',
      'Staff retention',
      'Analytics',
      [{ name: 'Analytics › Staff Analysis', path: '/analytics/retention/staff' }],
      'See the staff cabin-retention analysis.'
    ),
    perm(
      'sheets.export',
      'Google Sheets export',
      'Google Sheets export',
      'Manage tools',
      [{ name: 'Manage › Sheets', path: '/manage/sheets' }],
      'Run the Google Sheets exports and see how they went.'
    ),
    perm(
      'users.manage',
      'Assign roles',
      'Assign roles',
      'People',
      [{ name: 'Users', path: '/users' }],
      "Give and remove other staff's roles."
    ),
  ],
  areas: ['Summer and Weekend', 'Camperships', 'Analytics', 'Manage tools', 'People'],
  admin_only: ['Manage › Sync', 'Manage › Config', 'Manage › Audit log', 'Role editing'],
  total: 7,
}

export function makeProps(
  url: Partial<UsersPageProps['url']> = {}
): UsersPageProps & { url: UsersPageProps['url'] } {
  // Fresh copies per call: a test that edits a role must not leak into the next one.
  const roles = ROLES.map((r) => ({ ...r, permissions: [...r.permissions] }))
  const roleLikes = roles.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    permissions: r.permissions,
  }))
  const held = rolesByUser(
    USERS.map((u) => ({ id: u.id, is_admin: Boolean(u['is_admin']) })),
    LINKS,
    roleLikes
  )
  return {
    data: {
      users: USERS,
      roles,
      roleLikes,
      userRoles: LINKS,
      held,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    },
    registry: {
      data: REGISTRY,
      isLoading: false,
      error: null,
    } as unknown as UsersPageProps['registry'],
    url: {
      tab: 'users',
      bucket: null,
      roleId: null,
      page: 1,
      focus: null,
      setTab: vi.fn(),
      setBucket: vi.fn(),
      setRole: vi.fn(),
      setPage: vi.fn(),
      ...url,
    },
  }
}
