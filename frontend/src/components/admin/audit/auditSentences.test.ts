/**
 * Every type and action the audit log writes has a sentence (spec §7), and the
 * Before/After cells read the changed fields. Fictional people only.
 *
 * Controller ruling (2026-09-26): `user_roles` grants/removals/updates are
 * type `access`, not `roles` — `roles` is reserved for role *definitions*
 * (the `roles` collection). The role-assignment cases below sit under Access.
 */
import { describe, expect, it } from 'vitest'

import type { AuditEntry } from '../../../types/auditLog'
import {
  describeEntry,
  fieldChanges,
  formatValue,
  whenTitle,
  type SentencePart,
} from './auditSentences'

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'r000000000000001',
    created: '2026-09-25T16:20:07Z',
    type: 'settings',
    action: 'update',
    actor_kind: 'user',
    actor_email: 'alex.rivera@example.com',
    actor_name: 'Alex Rivera',
    fields: [],
    ...overrides,
  }
}

/** A sentence as plain text, with parts marked: *strong*, [chip], `mono`. */
function said(e: AuditEntry): string {
  return describeEntry(e)
    .map((p: SentencePart) =>
      p.kind === 'strong'
        ? `*${p.text}*`
        : p.kind === 'chip'
          ? `[${p.text}]`
          : p.kind === 'mono'
            ? `\`${p.text}\``
            : p.text
    )
    .join('')
}

describe('describeEntry', () => {
  it.each<[string, Partial<AuditEntry>, string]>([
    // Access
    [
      'first sign-in',
      { type: 'access', action: 'create', collection: 'users', detail: { via: 'first_sign_in' } },
      'account created at first sign-in',
    ],
    [
      'account created by a superuser',
      { type: 'access', action: 'create', collection: 'users', target_label: 'Sam Patel' },
      'created the account *Sam Patel*',
    ],
    [
      'admin granted by a superuser',
      {
        type: 'access',
        action: 'update',
        collection: 'users',
        target_label: 'Sam Patel',
        after: { is_admin: true },
      },
      'made *Sam Patel* an admin',
    ],
    [
      'admin removed by a superuser',
      {
        type: 'access',
        action: 'update',
        collection: 'users',
        target_label: 'Sam Patel',
        after: { is_admin: false },
      },
      'removed admin access from *Sam Patel*',
    ],
    [
      'account edited',
      {
        type: 'access',
        action: 'update',
        collection: 'users',
        target_label: 'Sam Patel',
        after: { name: 'Sam P.' },
      },
      'edited the account *Sam Patel*',
    ],
    [
      'account removed',
      { type: 'access', action: 'delete', collection: 'users', target_label: 'Riley Sam' },
      'removed user *Riley Sam*',
    ],
    [
      'superuser added',
      {
        type: 'access',
        action: 'create',
        collection: '_superusers',
        target_label: 'second.admin@example.com',
      },
      'added the superuser *second.admin@example.com*',
    ],
    [
      'superuser removed',
      {
        type: 'access',
        action: 'delete',
        collection: '_superusers',
        target_label: 'second.admin@example.com',
      },
      'removed the superuser *second.admin@example.com*',
    ],
    [
      'group grant',
      { type: 'access', action: 'admin_granted', actor_kind: 'system' },
      'became an admin through the Pocket ID admin group',
    ],
    [
      'group removal',
      { type: 'access', action: 'admin_removed', actor_kind: 'system' },
      'lost admin through the Pocket ID admin group',
    ],
    [
      'role given',
      {
        type: 'access',
        action: 'create',
        collection: 'user_roles',
        target_label: 'Sam Patel',
        detail: { role: 'Registrar' },
      },
      'gave *Sam Patel* a role',
    ],
    [
      'role taken',
      {
        type: 'access',
        action: 'delete',
        collection: 'user_roles',
        target_label: 'Taylor Brooks',
        detail: { role: 'Finance' },
      },
      'removed a role from *Taylor Brooks*',
    ],
    [
      'role changed',
      {
        type: 'access',
        action: 'update',
        collection: 'user_roles',
        target_label: 'Sam Patel',
      },
      'changed a role of *Sam Patel*',
    ],
    // Roles (role DEFINITIONS only — see controller ruling above)
    [
      'role created',
      { type: 'roles', action: 'create', collection: 'roles', target_label: 'Development' },
      'created the [Development] role',
    ],
    [
      'role edited',
      { type: 'roles', action: 'update', collection: 'roles', target_label: 'Finance' },
      'edited the [Finance] role',
    ],
    [
      'role deleted',
      { type: 'roles', action: 'delete', collection: 'roles', target_label: 'Finance' },
      'deleted the [Finance] role',
    ],
    // Permission description overrides share the Roles type but are not roles
    [
      'a description reworded (create)',
      {
        type: 'roles',
        action: 'create',
        collection: 'permission_descriptions',
        target_label: 'financial_aid.view',
      },
      'reworded the description of [financial_aid.view]',
    ],
    [
      'a description reworded (update)',
      {
        type: 'roles',
        action: 'update',
        collection: 'permission_descriptions',
        target_label: 'financial_aid.view',
      },
      'reworded the description of [financial_aid.view]',
    ],
    [
      'a description reset',
      {
        type: 'roles',
        action: 'delete',
        collection: 'permission_descriptions',
        target_label: 'financial_aid.view',
      },
      'reset the description of [financial_aid.view]',
    ],
    // View as
    [
      'a whole preview',
      {
        type: 'view_as',
        action: 'view_as_start',
        detail: { persona: 'Registrar' },
        ended: '2026-09-25T16:34:07Z',
      },
      'previewed as [Registrar] for 14 min',
    ],
    [
      'a short preview',
      {
        type: 'view_as',
        action: 'view_as_start',
        detail: { persona: 'Finance' },
        ended: '2026-09-25T16:20:30Z',
      },
      'previewed as [Finance] for under a minute',
    ],
    // Settings
    [
      'config edited',
      {
        type: 'settings',
        action: 'update',
        collection: 'config',
        target_label: 'registration.summer_open',
      },
      'changed the setting `registration.summer_open`',
    ],
    [
      'config added',
      {
        type: 'settings',
        action: 'create',
        collection: 'config',
        target_label: 'solver.max_cabin_size',
      },
      'added the setting `solver.max_cabin_size`',
    ],
    [
      'unit edited',
      { type: 'settings', action: 'update', collection: 'lodging_units', target_label: 'Cabin 14' },
      'edited lodging unit *Cabin 14*',
    ],
    [
      'area added',
      {
        type: 'settings',
        action: 'create',
        collection: 'lodging_areas',
        target_label: 'North Meadow',
      },
      'added lodging area *North Meadow*',
    ],
    [
      'alias removed',
      {
        type: 'settings',
        action: 'delete',
        collection: 'lodging_unit_aliases',
        target_label: 'C14',
      },
      'removed cabin alias *C14*',
    ],
    [
      'import issue',
      {
        type: 'settings',
        action: 'update',
        collection: 'lodging_ingest_issues',
        target_label: 'Cabn 14',
      },
      'edited import issue *Cabn 14*',
    ],
    [
      'weekend status',
      {
        type: 'settings',
        action: 'update',
        collection: 'lodging_session_status',
        target_label: 'Spring Weekend',
      },
      'set the weekend status of *Spring Weekend*',
    ],
    [
      'full sync',
      {
        type: 'settings',
        action: 'sync_run',
        detail: { route: 'run', service: 'all', year: 2026, include_custom_values: true },
      },
      'ran a full sync for *2026* (with custom values)',
    ],
    [
      'one service',
      {
        type: 'settings',
        action: 'sync_run',
        detail: { route: 'run', service: 'bunk_assignments', year: 2026 },
      },
      'ran the *bunk assignments* sync for *2026*',
    ],
    [
      'a phase',
      {
        type: 'settings',
        action: 'sync_run',
        detail: { route: 'run-phase', phase: 'source', year: 2026 },
      },
      'ran the *source* phase for *2026*',
    ],
    [
      'an individual job',
      { type: 'settings', action: 'sync_run', detail: { route: 'custom-values', dry_run: true } },
      'ran the *custom values* sync (dry run)',
    ],
    [
      'roll-forward',
      {
        type: 'settings',
        action: 'roll_forward',
        detail: { from_year: 2026, to_year: 2027, units_created: 42 },
      },
      'rolled the lodging registry forward from *2026* to *2027* (42 units)',
    ],
    // PB Admin
    [
      'record edited',
      {
        type: 'pb_admin',
        action: 'update',
        collection: 'config',
        target_label: 'solver.max_cabin_size',
      },
      'edited *config* · `solver.max_cabin_size`',
    ],
    [
      'record deleted, no label',
      {
        type: 'pb_admin',
        action: 'delete',
        collection: 'bunk_requests',
        record_id: 'p0q9w8e7r6t5y4u',
      },
      'deleted *bunk_requests* · `p0q9w8e7r6t5y4u`',
    ],
    [
      'collection created',
      {
        type: 'pb_admin',
        action: 'schema_change',
        collection: 'probe',
        detail: { operation: 'create' },
      },
      'created the collection *probe*',
    ],
    [
      'collection changed',
      {
        type: 'pb_admin',
        action: 'schema_change',
        collection: 'lodging_units',
        detail: { operation: 'update' },
      },
      'changed the schema of *lodging_units*',
    ],
    [
      'collection deleted',
      {
        type: 'pb_admin',
        action: 'schema_change',
        collection: 'probe',
        detail: { operation: 'delete' },
      },
      'deleted the collection *probe*',
    ],
    [
      'import',
      {
        type: 'pb_admin',
        action: 'schema_change',
        detail: { operation: 'import', collections: ['a', 'b'] },
      },
      'imported collections (2)',
    ],
    [
      'settings',
      { type: 'pb_admin', action: 'settings_change' },
      'changed the PocketBase settings',
    ],
    [
      'impersonation',
      { type: 'pb_admin', action: 'impersonate', collection: 'users', target_label: 'Sam Patel' },
      'impersonated *Sam Patel*',
    ],
    // Sign-ins
    [
      'Pocket ID',
      { type: 'sign_in', action: 'sign_in', detail: { method: 'oauth2', collection: 'users' } },
      'signed in',
    ],
    [
      'PocketBase admin',
      {
        type: 'sign_in',
        action: 'sign_in',
        detail: { method: 'password', collection: '_superusers' },
      },
      'signed in to PocketBase admin',
    ],
  ])('%s', (_name, overrides, want) => {
    expect(said(entry(overrides))).toBe(want)
  })

  it('an open preview says when it started and that no end was recorded', () => {
    const got = said(
      entry({
        type: 'view_as',
        action: 'view_as_start',
        detail: { persona: 'Registrar' },
        ended: null,
      })
    )
    expect(got).toMatch(/^previewed as \[Registrar\], from \d\d:\d\d \(no end recorded\)$/)
  })
})

describe('fieldChanges', () => {
  it('reads the changed fields in the server order', () => {
    const got = fieldChanges(
      entry({
        fields: ['beds', 'notes'],
        before: { beds: 8, notes: '' },
        after: { beds: 10, notes: 'Two cabins added' },
      })
    )
    expect(got).toEqual([
      { field: 'beds', before: '8', after: '10' },
      { field: 'notes', before: null, after: 'Two cabins added' },
    ])
  })

  it('shows a role assignment as the role name', () => {
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'create',
          detail: { role: 'Registrar' },
        })
      )
    ).toEqual([{ field: 'role', before: null, after: 'Registrar' }])
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'delete',
          detail: { role: 'Finance' },
        })
      )
    ).toEqual([{ field: 'role', before: 'Finance', after: null }])
  })

  it('a role update reads the generic before/after path, not the role-assignment shape', () => {
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'update',
          fields: ['role'],
          before: { role: 'Registrar' },
          after: { role: 'Finance' },
        })
      )
    ).toEqual([{ field: 'role', before: 'Registrar', after: 'Finance' }])
  })

  // kindred#2880 follow-up: a role UPDATE's raw before/after are PocketBase
  // relation ids (record ids, not names). The Go writer resolves names into
  // detail.role / detail.role_before (and .user / .user_before when the user
  // relation itself changed); the frontend must read THOSE, not the raw ids.
  it('a role update with resolved names in detail shows role names, not raw ids', () => {
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'update',
          fields: ['role'],
          before: { role: 'roleregistrar01' },
          after: { role: 'rolefinance0001' },
          detail: { role: 'Finance', role_before: 'Registrar' },
        })
      )
    ).toEqual([{ field: 'role', before: 'Registrar', after: 'Finance' }])
  })

  it('a role update that also reassigns the user shows both names, not raw ids', () => {
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'update',
          fields: ['role', 'user'],
          before: { role: 'roleregistrar01', user: 'sampatel0000001' },
          after: { role: 'rolefinance0001', user: 'usertaylor00001' },
          detail: {
            role: 'Finance',
            role_before: 'Registrar',
            user: 'Taylor Kim',
            user_before: 'Sam Patel',
          },
        })
      )
    ).toEqual([
      { field: 'role', before: 'Registrar', after: 'Finance' },
      { field: 'user', before: 'Sam Patel', after: 'Taylor Kim' },
    ])
  })

  it('falls back to the raw id only when a name is missing (an old row with no role_before)', () => {
    expect(
      fieldChanges(
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'update',
          fields: ['role'],
          before: { role: 'roleregistrar01' },
          after: { role: 'rolefinance0001' },
          detail: { role: 'Finance' },
        })
      )
    ).toEqual([{ field: 'role', before: 'roleregistrar01', after: 'Finance' }])
  })

  it('formats lists, booleans and redactions', () => {
    expect(formatValue(['financial_aid.view', 'financial_aid.casework'])).toBe(
      'financial_aid.view, financial_aid.casework'
    )
    expect(formatValue(false)).toBe('false')
    expect(formatValue('[redacted]')).toBe('[redacted]')
    expect(formatValue([])).toBeNull()
  })
})

describe('whenTitle', () => {
  it('carries the seconds and the IP', () => {
    const title = whenTitle(entry({ ip: '10.0.20.5' }))
    expect(title).toMatch(/\d\d:\d\d:07 · IP 10\.0\.20\.5$/)
  })
})
