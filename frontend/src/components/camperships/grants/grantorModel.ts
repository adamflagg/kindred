/**
 * Money › Funders' words and edits (spec §8.2; D86, D143, D160; grants-v2.html; owner 10-06,
 * rulings:676). Pure. The form sends a whole record and keeps the server's two full-coverage rules
 * (`api/schemas/financial_aid_grants.py:44–53`: covers_canteen and pays_after_camp_aid are recorded only
 * for a full-coverage grantor), so it never sends what the route refuses. A grantor's award terms are
 * those three facts, said in words ("pays the rest after camp aid · no canteen").
 */
import type {
  ApiAidGrantor,
  ApiAidGrantorCreate,
  ApiAidGrantorSave,
} from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'

export type CoversCanteen = ApiAidGrantor['covers_canteen']

export const CANTEEN_WORDS = {
  unknown: 'not known',
  yes: 'yes',
  no: 'no',
} as const satisfies Record<CoversCanteen, string>

export const CANTEEN_CHOICES = Object.keys(CANTEEN_WORDS) as CoversCanteen[]

/** The canteen inside the award terms: "with canteen", "no canteen", "canteen not known". */
const CANTEEN_TERMS = {
  unknown: 'canteen not known',
  yes: 'with canteen',
  no: 'no canteen',
} as const satisfies Record<CoversCanteen, string>

/** "grantor_a" from "Grantor A": the route's key rule (a letter, then letters, digits, `_`; 60 at most). */
export function suggestKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const lettered = /^[a-z]/.test(slug) ? slug : `g_${slug}`
  return lettered.slice(0, 60).replace(/_+$/, '')
}

export const KEY_RULE = /^[a-z][a-z0-9_]*$/

export interface GrantorDraft {
  readonly key: string
  readonly name: string
  readonly aliases: string
  readonly fullCoverage: boolean
  readonly coversCanteen: CoversCanteen
  readonly paysAfter: boolean
  readonly eligibility: string
  readonly contacts: string
  readonly note: string
}

export const EMPTY_GRANTOR: GrantorDraft = {
  key: '',
  name: '',
  aliases: '',
  fullCoverage: false,
  coversCanteen: 'unknown',
  paysAfter: false,
  eligibility: '',
  contacts: '',
  note: '',
}

export function draftOfGrantor(g: ApiAidGrantor): GrantorDraft {
  return {
    key: g.key,
    name: g.name,
    aliases: g.aliases.join(', '),
    fullCoverage: g.full_coverage,
    coversCanteen: g.covers_canteen,
    paysAfter: g.pays_after_camp_aid,
    eligibility: g.eligibility,
    contacts: g.contacts,
    note: '',
  }
}

/** Every save sends the whole record (the route replaces it), full coverage's two facts kept to its rule. */
function fields(draft: GrantorDraft): ApiAidGrantorSave {
  return {
    name: draft.name.trim(),
    aliases: draft.aliases
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a !== ''),
    full_coverage: draft.fullCoverage,
    covers_canteen: draft.fullCoverage ? draft.coversCanteen : 'unknown',
    pays_after_camp_aid: draft.fullCoverage && draft.paysAfter,
    eligibility: draft.eligibility.trim(),
    contacts: draft.contacts.trim(),
    note: draft.note.trim(),
  }
}

export type GrantorRead<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly problem: string }

export function readSave(draft: GrantorDraft): GrantorRead<ApiAidGrantorSave> {
  if (draft.name.trim() === '') return { ok: false, problem: 'Name the funder' }
  if (draft.note.trim() === '') return { ok: false, problem: 'A note is required (it is logged)' }
  return { ok: true, body: fields(draft) }
}

export function readCreate(draft: GrantorDraft): GrantorRead<ApiAidGrantorCreate> {
  const saved = readSave(draft)
  if (!saved.ok) return saved
  const key = draft.key.trim()
  if (!KEY_RULE.test(key) || key.length > 60) {
    return { ok: false, problem: 'The key is a letter, then letters, digits or _ (60 at most)' }
  }
  return { ok: true, body: { ...saved.body, key } }
}

/** What an edit watches between opening and saving (P-9). */
export const GRANTOR_WATCHED: ReadonlyArray<readonly [keyof ApiAidGrantor, string]> = [
  ['name', 'Name'],
  ['aliases', 'Also known as'],
  ['full_coverage', 'Full coverage'],
  ['covers_canteen', 'Covers the canteen'],
  ['pays_after_camp_aid', 'Pays the rest after camp aid'],
  ['eligibility', 'Eligibility'],
  ['contacts', 'Contacts'],
  ['retired_at', 'Retired'],
]

/**
 * The award terms in words (owner 10-06, rulings:676): "pays the rest after camp aid · no canteen" for a
 * named fund, "covers the full cost · canteen not known" for a full-ride grantor; "" for a grantor whose
 * grant is simply what CampMinder posts (no terms).
 */
export function termsWords(g: ApiAidGrantor): string {
  if (!g.full_coverage) return ''
  const pays = g.pays_after_camp_aid ? 'pays the rest after camp aid' : 'covers the full cost'
  return `${pays} · ${CANTEEN_TERMS[g.covers_canteen]}`
}

/** The directory's three term columns (grants-v2.html): "n/a" where the fact applies to full coverage only. */
export const fullCoverageCell = (g: ApiAidGrantor) => (g.full_coverage ? 'yes' : '—')
export const canteenCell = (g: ApiAidGrantor) =>
  g.full_coverage ? CANTEEN_WORDS[g.covers_canteen] : 'n/a'
export const paysAfterCell = (g: ApiAidGrantor) =>
  g.full_coverage ? (g.pays_after_camp_aid ? 'yes' : 'no') : 'n/a'

export const isRetired = (g: ApiAidGrantor) => g.retired_at !== ''

/**
 * Why Retire… is off, from what the read knows: a mapped description (the server refuses it, 409,
 * `financial_aid_grants_service.py` retire_grantor). Open commitments in any season also block it, but
 * the read doesn't count them, so for those the button stays on and the server's sentence answers.
 */
export function retireBlocked(g: ApiAidGrantor): string | null {
  const n = g.descriptions.length
  if (n === 0) return null
  return n === 1
    ? '1 CampMinder description still maps to it. Map it to another funder first.'
    : `${String(n)} CampMinder descriptions still map to it. Map them to another funder first.`
}

/** The season's grant lines and their net (GET /grantors?year=); null when the read has no season. */
export const seasonCount = (g: ApiAidGrantor): number | null => g.season?.count ?? null
/** "—" (null) when no line names the grantor this season; "$0" stays a real net of zero. */
export const seasonAmount = (g: ApiAidGrantor): number | null =>
  g.season === undefined || g.season === null || g.season.count === 0 ? null : g.season.amount

export function grantorsCsvName(year: number): string {
  return aidCsvFilename({ surface: 'grants', view: 'grantors', season: year })
}
