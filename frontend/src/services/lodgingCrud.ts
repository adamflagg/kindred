/**
 * Family Camp lodging registry CRUD.
 *
 * Writes go straight to PocketBase through the JS SDK, not through FastAPI:
 * all lodging collections carry `@request.auth.is_admin = true` on create,
 * update and delete, so PocketBase is the authorisation boundary, and the Go
 * record hooks in `pocketbase/lodging` are the integrity boundary.
 *
 * Nothing in the registry is hardcoded anywhere in this repo (spec §3.8) —
 * areas, units, aliases, parent relations, staff-default flags and amenity
 * values are all rows, editable here.
 */

import { pb } from '../lib/pocketbase'
import type {
  LodgingAliasInput,
  LodgingAliasRecord,
  LodgingAreaInput,
  LodgingAreaRecord,
  LodgingIngestIssueRecord,
  LodgingUnitInput,
  LodgingUnitRecord,
} from '../types/lodging'

const AREAS = 'lodging_areas'
const UNITS = 'lodging_units'
const ALIASES = 'lodging_unit_aliases'

/**
 * The ingest work queue.
 *
 * ONE collection, produced solely by the Go ingest. The plan drafted a separate
 * `lodging_unresolved_aliases`; that was rejected because this model is a
 * superset (it carries `kind`, `candidate_session_cm_ids`, `suggested_session`)
 * and a second producer-less table would only drift.
 */
const INGEST_ISSUES = 'lodging_ingest_issues'

const ALIAS_NEEDS_A_UNIT = 'An alias must map to at least one unit.'

// ── Areas ─────────────────────────────────────────────────────────────────────

export async function listLodgingAreas(): Promise<LodgingAreaRecord[]> {
  return pb.collection(AREAS).getFullList<LodgingAreaRecord>({ sort: 'sort_order,name' })
}

export async function createLodgingArea(input: LodgingAreaInput): Promise<LodgingAreaRecord> {
  return pb.collection(AREAS).create<LodgingAreaRecord>({ ...input })
}

export async function updateLodgingArea(
  id: string,
  input: Partial<LodgingAreaInput>
): Promise<LodgingAreaRecord> {
  return pb.collection(AREAS).update<LodgingAreaRecord>(id, { ...input })
}

/**
 * PocketBase blocks this with HTTP 400 when any unit still references the
 * area — `lodging_units.area` is a REQUIRED relation, and PocketBase refuses
 * to delete behind a required relation rather than clearing the reference.
 * The caller should surface that error rather than pre-checking.
 */
export async function deleteLodgingArea(id: string): Promise<void> {
  await pb.collection(AREAS).delete(id)
}

// ── Units ─────────────────────────────────────────────────────────────────────

export async function listLodgingUnits(): Promise<LodgingUnitRecord[]> {
  return pb
    .collection(UNITS)
    .getFullList<LodgingUnitRecord>({ expand: 'area,parent_unit', sort: 'area.sort_order,name' })
}

/**
 * Create a unit.
 *
 * `is_active` and `allocation_default` are ALWAYS written, and `is_container`
 * and `is_confirmed` default to false explicitly. PocketBase has no per-field
 * default for bool or select, so anything omitted here lands as `false` / `''`:
 * a unit that no list query returns and that matches neither branch of the
 * availability rules. This is the single most expensive mistake available on
 * this surface.
 */
export async function createLodgingUnit(input: LodgingUnitInput): Promise<LodgingUnitRecord> {
  return pb.collection(UNITS).create<LodgingUnitRecord>({
    ...input,
    is_active: input.is_active,
    allocation_default: input.allocation_default,
    is_container: input.is_container ?? false,
    is_confirmed: input.is_confirmed ?? false,
  })
}

export async function updateLodgingUnit(
  id: string,
  input: Partial<LodgingUnitInput>
): Promise<LodgingUnitRecord> {
  return pb.collection(UNITS).update<LodgingUnitRecord>(id, { ...input })
}

/**
 * Deactivate rather than delete (spec §3.8).
 *
 * A unit with historical assignments must stay resolvable so 2022-2025
 * placements still render. There is deliberately no delete function here;
 * the Go guard in `pocketbase/lodging` blocks a referenced unit's deletion
 * wherever it is attempted from, including the PocketBase admin UI.
 */
export async function deactivateLodgingUnit(id: string): Promise<LodgingUnitRecord> {
  return pb.collection(UNITS).update<LodgingUnitRecord>(id, { is_active: false })
}

/** Undo a deactivation. Distinct from create so it cannot reset other fields. */
export async function reactivateLodgingUnit(id: string): Promise<LodgingUnitRecord> {
  return pb.collection(UNITS).update<LodgingUnitRecord>(id, { is_active: true })
}

// ── Aliases ───────────────────────────────────────────────────────────────────

export async function listLodgingAliases(): Promise<LodgingAliasRecord[]> {
  return pb
    .collection(ALIASES)
    .getFullList<LodgingAliasRecord>({ expand: 'member_units', sort: 'alias_string' })
}

export async function createLodgingAlias(input: LodgingAliasInput): Promise<LodgingAliasRecord> {
  if (input.member_units.length === 0) {
    throw new Error(ALIAS_NEEDS_A_UNIT)
  }
  return pb.collection(ALIASES).create<LodgingAliasRecord>({ ...input })
}

export async function updateLodgingAlias(
  id: string,
  input: Partial<LodgingAliasInput>
): Promise<LodgingAliasRecord> {
  if (input.member_units?.length === 0) {
    throw new Error(ALIAS_NEEDS_A_UNIT)
  }
  return pb.collection(ALIASES).update<LodgingAliasRecord>(id, { ...input })
}

export async function deleteLodgingAlias(id: string): Promise<void> {
  await pb.collection(ALIASES).delete(id)
}

// ── Ingest work queue ─────────────────────────────────────────────────────────

/**
 * The open unresolved-cabin-name queue.
 *
 * Filtered to `kind = "unresolved_alias"` because the other six kinds
 * (ambiguous sessions, unknown parties, write failures…) are not fixable by
 * mapping a name to a unit, and mixing them into this list would offer staff
 * an action that cannot resolve the row.
 */
export async function listUnresolvedAliasIssues(): Promise<LodgingIngestIssueRecord[]> {
  return pb.collection(INGEST_ISSUES).getFullList<LodgingIngestIssueRecord>({
    filter: 'kind = "unresolved_alias" && is_resolved = false',
    sort: '-occurrences,raw_value',
  })
}

/**
 * The one-click "map this to a unit" action.
 *
 * Creates the real alias row, then marks the queue row resolved and links it,
 * so the audit trail shows what the string was resolved to. One member unit
 * means an atomic room; two or more denote a merge.
 *
 * The alias is created FIRST: if the create fails, the queue row stays open,
 * which is the recoverable direction. Resolving first would lose the work item
 * on a failed create.
 */
export async function mapUnresolvedAlias(
  queueId: string,
  aliasString: string,
  unitIds: string[],
  options: { validFromYear?: number; validToYear?: number; sourceField?: string } = {}
): Promise<LodgingAliasRecord> {
  if (unitIds.length === 0) {
    throw new Error('Map the cabin name to at least one unit before saving.')
  }
  const alias = await pb.collection(ALIASES).create<LodgingAliasRecord>({
    alias_string: aliasString,
    member_units: unitIds,
    valid_from_year: options.validFromYear,
    valid_to_year: options.validToYear,
    source_field: options.sourceField,
  })
  await pb.collection(INGEST_ISSUES).update(queueId, {
    is_resolved: true,
    resolved_alias: alias.id,
  })
  return alias
}

/**
 * Resolve a queue row without mapping it — e.g. a note staff typed into the
 * cabin field, which is not a cabin name at all.
 *
 * `resolved_alias` deliberately stays empty. That is what distinguishes an
 * ignored row from a mapped one, since both set `is_resolved`.
 */
export async function ignoreIngestIssue(
  queueId: string,
  note: string
): Promise<LodgingIngestIssueRecord> {
  return pb.collection(INGEST_ISSUES).update<LodgingIngestIssueRecord>(queueId, {
    is_resolved: true,
    resolution_note: note,
  })
}
