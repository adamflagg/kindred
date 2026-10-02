/**
 * The audit log's "What happened" sentences and Before/After cells, built on
 * the client from the structured fields (spec 2026-09-26 §6). Pure, so every
 * type and action is pinned by auditSentences.test.ts.
 *
 * A sentence is a list of parts; AuditLogTab renders `strong` in bold, `chip`
 * as the role/persona chip and `mono` in small monospace (mockup v8).
 *
 * Controller ruling (2026-09-26): `user_roles` grants, removals and updates
 * are type `access` (the Go writer classifies them so) — `roles` is reserved
 * for role *definitions* (the `roles` collection). `accessSentence` handles
 * `user_roles` first, ahead of the `_superusers` check.
 */
import type { AuditEntry } from '../../../types/auditLog'

export type SentencePart =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'chip'; text: string }
  | { kind: 'mono'; text: string }

const t = (text: string): SentencePart => ({ kind: 'text', text })
const b = (text: string): SentencePart => ({ kind: 'strong', text })
const chip = (text: string): SentencePart => ({ kind: 'chip', text })
const mono = (text: string): SentencePart => ({ kind: 'mono', text })

function detailOf(entry: AuditEntry): Record<string, unknown> {
  return entry.detail ?? {}
}

/** The first value that is a non-empty string, else ''. Empty strings count as missing. */
export function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) if (value) return value
  return ''
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/** "bunk-assignments" → "bunk assignments". */
function humanize(route: string): string {
  return route.replace(/[-_]/g, ' ')
}

// ── Verb wordings — each declared once, read through `verb()` (controller
// ruling: no inline verb-table literals; a distinct wording gets one name). ──

/** Role definitions (the `roles` collection), and a generic PB Admin verb. */
const VERB_DEFINITION: Record<string, string> = {
  create: 'created',
  update: 'edited',
  delete: 'deleted',
}
/** Adding/editing/removing a member of a collection or registry (superusers,
 * the lodging registry). */
const VERB_MEMBER: Record<string, string> = { create: 'added', update: 'edited', delete: 'removed' }
/** A `config` row: "changed", not "edited" — it's a setting, not a record. */
const VERB_SETTING: Record<string, string> = {
  create: 'added',
  update: 'changed',
  delete: 'removed',
}

function verb(table: Record<string, string>, action: string): string {
  return table[action] ?? action
}

/** Registry nouns for the Settings sentences. */
const LODGING_NOUN: Record<string, string> = {
  lodging_units: 'lodging unit',
  lodging_areas: 'lodging area',
  lodging_unit_aliases: 'cabin alias',
  lodging_ingest_issues: 'import issue',
}

function accessSentence(entry: AuditEntry): SentencePart[] {
  const target = firstText(entry.target_label, entry.record_id, 'an account')
  const after = entry.after ?? {}

  // Owner ruling: a role grant/removal/update is Access, not Roles.
  if (entry.collection === 'user_roles') {
    if (entry.action === 'delete') return [t('removed a role from '), b(target)]
    if (entry.action === 'create') return [t('gave '), b(target), t(' a role')]
    return [t('changed a role of '), b(target)] // update: a superuser-only path
  }
  if (entry.action === 'admin_granted')
    return [t('became an admin through the Pocket ID admin group')]
  if (entry.action === 'admin_removed') return [t('lost admin through the Pocket ID admin group')]
  if (entry.collection === '_superusers') {
    return [t(`${verb(VERB_MEMBER, entry.action)} the superuser `), b(target)]
  }
  switch (entry.action) {
    case 'create':
      return detailOf(entry)['via'] === 'first_sign_in'
        ? [t('account created at first sign-in')]
        : [t('created the account '), b(target)]
    case 'delete':
      return [t('removed user '), b(target)]
    default:
      if ('is_admin' in after) {
        return after['is_admin'] === true
          ? [t('made '), b(target), t(' an admin')]
          : [t('removed admin access from '), b(target)]
      }
      return [t('edited the account '), b(target)]
  }
}

/** Role DEFINITIONS (the `roles` collection) and permission-description overrides — see the ruling above. */
function rolesSentence(entry: AuditEntry): SentencePart[] {
  const target = firstText(entry.target_label, entry.record_id)
  // Permission-description overrides audit under the same Roles type.
  if (entry.collection === 'permission_descriptions') {
    return [
      t(`${entry.action === 'delete' ? 'reset' : 'reworded'} the description of `),
      chip(target),
    ]
  }
  return [t(`${verb(VERB_DEFINITION, entry.action)} the `), chip(target), t(' role')]
}

function viewAsSentence(entry: AuditEntry): SentencePart[] {
  const persona = firstText(str(detailOf(entry)['persona']), 'a persona')
  if (entry.ended) {
    const minutes = Math.round((Date.parse(entry.ended) - Date.parse(entry.created)) / 60000)
    const span = minutes < 1 ? 'under a minute' : `${String(minutes)} min`
    return [t('previewed as '), chip(persona), t(` for ${span}`)]
  }
  return [
    t('previewed as '),
    chip(persona),
    t(`, from ${clockTime(entry.created)} (no end recorded)`),
  ]
}

function syncSentence(entry: AuditEntry): SentencePart[] {
  const d = detailOf(entry)
  const year = str(d['year'])
  const route = str(d['route'])
  const tail: SentencePart[] = []
  if (d['include_custom_values'] === true) tail.push(t(' (with custom values)'))
  if (d['dry_run'] === true) tail.push(t(' (dry run)'))
  const forYear = year ? [t(' for '), b(year)] : []
  if (route === 'run' && str(d['service']) === 'all')
    return [t('ran a full sync'), ...forYear, ...tail]
  if (route === 'run')
    return [t('ran the '), b(humanize(str(d['service']))), t(' sync'), ...forYear, ...tail]
  if (route === 'run-phase')
    return [t('ran the '), b(str(d['phase'])), t(' phase'), ...forYear, ...tail]
  return [t('ran the '), b(humanize(route)), t(' sync'), ...forYear, ...tail]
}

function settingsSentence(entry: AuditEntry): SentencePart[] {
  const d = detailOf(entry)
  if (entry.action === 'sync_run') return syncSentence(entry)
  if (entry.action === 'roll_forward') {
    return [
      t('rolled the lodging registry forward from '),
      b(str(d['from_year'])),
      t(' to '),
      b(str(d['to_year'])),
      t(` (${firstText(str(d['units_created']), '0')} units)`),
    ]
  }
  const target = firstText(entry.target_label, entry.record_id)
  if (entry.collection === 'config') {
    return [t(`${verb(VERB_SETTING, entry.action)} the setting `), mono(target)]
  }
  if (entry.collection === 'lodging_session_status')
    return [t('set the weekend status of '), b(target)]
  const noun = LODGING_NOUN[entry.collection ?? ''] ?? entry.collection ?? 'record'
  return [t(`${verb(VERB_MEMBER, entry.action)} ${noun} `), b(target)]
}

function pbAdminSentence(entry: AuditEntry): SentencePart[] {
  const d = detailOf(entry)
  const collection = entry.collection ?? ''
  if (entry.action === 'settings_change') return [t('changed the PocketBase settings')]
  if (entry.action === 'impersonate')
    return [t('impersonated '), b(firstText(entry.target_label, entry.record_id))]
  if (entry.action === 'schema_change') {
    switch (str(d['operation'])) {
      case 'create':
        return [t('created the collection '), b(collection)]
      case 'delete':
        return [t('deleted the collection '), b(collection)]
      case 'import': {
        const names = Array.isArray(d['collections']) ? d['collections'].length : 0
        return [t(`imported collections (${String(names)})`)]
      }
      default:
        return [t('changed the schema of '), b(collection)]
    }
  }
  const label = firstText(entry.target_label, entry.record_id)
  const v = verb(VERB_DEFINITION, entry.action)
  return label ? [t(`${v} `), b(collection), t(' · '), mono(label)] : [t(`${v} `), b(collection)]
}

function signInSentence(entry: AuditEntry): SentencePart[] {
  return str(detailOf(entry)['collection']) === '_superusers'
    ? [t('signed in to PocketBase admin')]
    : [t('signed in')]
}

/** The "What happened" sentence for one entry. */
export function describeEntry(entry: AuditEntry): SentencePart[] {
  switch (entry.type) {
    case 'access':
      return accessSentence(entry)
    case 'roles':
      return rolesSentence(entry)
    case 'view_as':
      return viewAsSentence(entry)
    case 'settings':
      return settingsSentence(entry)
    case 'pb_admin':
      return pbAdminSentence(entry)
    case 'sign_in':
      return signInSentence(entry)
  }
}

/** The screen label for each type (mockup v8). */
export const TYPE_LABEL: Record<AuditEntry['type'], string> = {
  access: 'Access',
  roles: 'Roles',
  view_as: 'View as',
  settings: 'Settings',
  pb_admin: 'PB Admin',
  sign_in: 'Sign-in',
}

/** Who did it: the name, else the email. */
export function actorLabel(entry: AuditEntry): string {
  return firstText(entry.actor_name, entry.actor_email, 'unknown')
}

// ── Before / After ────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string
  before: string | null
  after: string | null
}

/** One value as the cell shows it; null renders as a dash. */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value))
    return value.length ? value.map((v) => formatValue(v) ?? '—').join(', ') : null
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** `user_roles` update fields whose raw before/after are relation ids, not
 * names — and the detail keys the Go writer resolves them into (label.go's
 * userRoleLabel). `role` is always resolved on both sides; `user` only when
 * the user relation itself changed (see the fallback below for why that's
 * safe to read unconditionally anyway). */
const USER_ROLE_NAME_KEYS: Record<string, { before: string; after: string }> = {
  role: { before: 'role_before', after: 'role' },
  user: { before: 'user_before', after: 'user' },
}

/** `detail[key]` when it resolved to a name, else the raw stored value —
 * covers rows written before this resolution existed (no `role_before`/
 * `user`/`user_before`), which fall back to the id they always had. */
function resolvedOrRaw(detail: Record<string, unknown>, key: string, raw: unknown): string | null {
  const resolved = str(detail[key])
  return resolved || formatValue(raw)
}

/**
 * The changed fields, in the order the server listed them. A `user_roles`
 * create/delete is shown as the role name (there is no `fields` array for a
 * grant/removal). An update falls through to the generic before/after path,
 * since it carries real fields (controller ruling) — except that its `role`
 * and `user` fields store PocketBase relation ids, not names: those two read
 * the resolved names the Go writer puts in `detail` instead (kindred#2880
 * follow-up), falling back to the raw id only when a name is missing.
 */
export function fieldChanges(entry: AuditEntry): FieldChange[] {
  if (entry.collection === 'user_roles' && entry.action !== 'update') {
    const role = firstText(str(detailOf(entry)['role'])) || null
    return [
      entry.action === 'delete'
        ? { field: 'role', before: role, after: null }
        : { field: 'role', before: null, after: role },
    ]
  }
  const before = entry.before ?? {}
  const after = entry.after ?? {}
  const isUserRoleUpdate = entry.collection === 'user_roles' && entry.action === 'update'
  const detail = detailOf(entry)
  return (entry.fields ?? []).map((field) => {
    const nameKeys = isUserRoleUpdate ? USER_ROLE_NAME_KEYS[field] : undefined
    if (nameKeys) {
      return {
        field,
        before: resolvedOrRaw(detail, nameKeys.before, before[field]),
        after: resolvedOrRaw(detail, nameKeys.after, after[field]),
      }
    }
    return {
      field,
      before: formatValue(before[field]),
      after: formatValue(after[field]),
    }
  })
}

// ── Long values (kindred#2880) ──────────────────────────────────────────────────
// A seeded config value was long enough to widen the Before/After column past its
// fixed width, or (with spaces) to wrap into an absurdly tall row. Both get a
// clamped preview and a "full value" control instead of rendering raw.

const LONG_VALUE_CHARS = 120

/** A value long enough to widen or over-tall its cell — more than ~120 chars, or multi-line. */
export function isLongValue(value: string | null): boolean {
  if (!value) return false
  return value.length > LONG_VALUE_CHARS || value.includes('\n')
}

/** Pretty-prints a Before/After value when it parses as JSON (object or array); otherwise unchanged. */
export function prettyPrintValue(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
  } catch {
    // Not JSON — show as-is.
  }
  return value
}

/** A sentence's parts as plain text, styling dropped — for a dialog title or similar. */
export function sentenceText(parts: SentencePart[]): string {
  return parts.map((part) => part.text).join('')
}

// ── Time ──────────────────────────────────────────────────────────────────────

/** "16:20" in the viewer's time zone. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** The When cell: "Fri, Sep 25 16:20". */
export function whenLabel(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} ${clockTime(iso)}`
}

/** The When cell's hover: full date, seconds and IP. */
export function whenTitle(entry: AuditEntry): string {
  const date = new Date(entry.created)
  const day = date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return entry.ip ? `${day} ${time} · IP ${entry.ip}` : `${day} ${time}`
}
