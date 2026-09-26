/**
 * Board notes -- the rules, as pure functions: one session's note, layered
 * plans.
 */
import type { NoteSubject, SubjectNoteRow } from '../../types/subjectNotes'
import type { PartyIdentity } from '../weekend/partyKey'

/** Locked (owner, 2026-09-25): "Note" everywhere. */
export const NOTE_LABEL = 'Note'
/** Locked: the hover preview shows the first 120 characters. */
export const PREVIEW_CHARS = 120
/** subject_notes.body's cap. */
export const NOTE_MAX = 2000

/** Matches `ModeBadge.tsx`'s fallback for an unnamed scenario. */
export const UNTITLED_SCENARIO = 'Untitled Scenario'

/**
 * The plan pill and the "+ Note just for …" link both need a name to show
 * even before the scenario's own name has loaded (hosts pass
 * `currentScenario?.name ?? ''`, so a bare empty string is a real transient
 * state, not a bug upstream). One place, so both `SubjectNoteEditor` and
 * `SubjectNotesSection` render the same fallback.
 */
export function displayScenarioName(name: string): string {
  return name === '' ? UNTITLED_SCENARIO : name
}

export interface SubjectLayers {
  standard?: SubjectNoteRow | undefined
  plan?: SubjectNoteRow | undefined
}

export const NO_LAYERS: SubjectLayers = Object.freeze({})

export type CornerMode = 'ghost' | 'standard' | 'plan'

export function subjectKey(subject: NoteSubject): string {
  return `${subject.kind}:${String(subject.cmId)}:${String(subject.sessionCmId)}`
}

export function indexNotes(rows: readonly SubjectNoteRow[]): Map<string, SubjectLayers> {
  const index = new Map<string, SubjectLayers>()
  for (const row of rows) {
    const key = subjectKey({
      kind: row.subject_kind,
      cmId: row.subject_cm_id,
      sessionCmId: row.session_cm_id,
    })
    const layers = index.get(key) ?? {}
    if (row.scenario === '') layers.standard = row
    else layers.plan = row
    index.set(key, layers)
  }
  return index
}

export function cornerState(layers: SubjectLayers): { mode: CornerMode; both: boolean } {
  if (layers.standard) return { mode: 'standard', both: layers.plan !== undefined }
  if (layers.plan) return { mode: 'plan', both: false }
  return { mode: 'ghost', both: false }
}

/** Cuts by CODE POINT, never a UTF-16 unit -- slicing on `.length`/`.slice` can land inside an
 * astral character's surrogate pair (e.g. an emoji) and emit a lone surrogate. */
export function previewText(body: string): string {
  const chars = Array.from(body)
  return chars.length > PREVIEW_CHARS
    ? `${chars.slice(0, PREVIEW_CHARS).join('').trimEnd()}…`
    : body
}

/** "+N more" under the preview: the plan-only note when a standard note leads. */
export function extraLayerCount(layers: SubjectLayers): number {
  return layers.standard && layers.plan ? 1 : 0
}

/**
 * A weekend party's subject, keyed by its GRAIN. `RosterParty`
 * serialises the unused grain's id as 0, so a 0 means "no subject" -- never a
 * note keyed to id 0 (see partyKey.ts on why `??` is wrong for these ids).
 */
export function partySubject(
  party: Pick<PartyIdentity, 'grain' | 'household_cm_id' | 'person_cm_id'>,
  sessionCmId: number
): NoteSubject | null {
  const isHousehold = party.grain === 'household'
  const cmId = (isHousehold ? party.household_cm_id : party.person_cm_id) ?? 0
  if (cmId <= 0 || sessionCmId <= 0) return null
  return { kind: isHousehold ? 'household' : 'person', cmId, sessionCmId }
}

/** A summer camper's subject: the camper's OWN session (an AG camper keeps the AG id). */
export function camperSubject(camper: {
  person_cm_id: number
  session_cm_id: number
}): NoteSubject | null {
  if (camper.person_cm_id <= 0 || camper.session_cm_id <= 0) return null
  return { kind: 'person', cmId: camper.person_cm_id, sessionCmId: camper.session_cm_id }
}

export interface NoteDrafts {
  standard?: string
  plan?: string
}

/** The layers whose trimmed text differs from what is saved. `plan: null` = no plan box. */
export function changedDrafts(
  layers: SubjectLayers,
  texts: { standard: string; plan: string | null }
): NoteDrafts {
  const drafts: NoteDrafts = {}
  if (texts.standard.trim() !== (layers.standard?.body ?? '')) drafts.standard = texts.standard
  if (texts.plan !== null && texts.plan.trim() !== (layers.plan?.body ?? ''))
    drafts.plan = texts.plan
  return drafts
}

/**
 * The server sends `updated` as a NAIVE timestamp -- UTC, but with no `Z` or
 * `±hh:mm` -- so `new Date(...)` would otherwise parse it as local time. An
 * evening Pacific edit would then read back a day ahead: parsed as local
 * 19:31 PDT is 02:31 UTC the NEXT day, and formatting that instant anywhere
 * east of it shows the wrong date. Appending `Z` when there's no offset
 * already fixes the instant; `timeZone` (the viewer's own, when omitted --
 * an explicit value is for tests only) then formats it correctly instead of
 * hardcoding UTC.
 */
function asUtcIso(timestamp: string): string {
  const iso = timestamp.replace(' ', 'T')
  return /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
}

export function editedLine(row: SubjectNoteRow | undefined, timeZone?: string): string {
  if (!row) return 'Nothing saved yet'
  const when = new Date(asUtcIso(row.updated))
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
  return [date ? `edited ${date}` : '', row.updated_by].filter(Boolean).join(' · ')
}
