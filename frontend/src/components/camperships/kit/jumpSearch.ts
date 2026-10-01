/**
 * The jump box's in-memory search (§3.5; D13): a family, camper or parent name, or a CampMinder
 * household or person id. One match per household, best first.
 */
import type { ApiAidJumpHousehold } from '../../../types/api-types'

import { fold } from './table'

export interface JumpMatch {
  readonly householdCmId: number
  readonly familyName: string
  /** Why it matched: "camper Emma Johnson", "household 1000001". */
  readonly detail: string
}

interface Candidate {
  readonly score: number
  readonly detail: string
}

function idCandidates(household: ApiAidJumpHousehold, query: string): Candidate[] {
  const out: Candidate[] = []
  const id = String(household.household_cm_id)
  if (id === query) out.push({ score: 100, detail: `household ${id}` })
  else if (id.startsWith(query)) out.push({ score: 60, detail: `household ${id}` })
  for (const person of household.people) {
    // A parent carries no CampMinder id in the read.
    if (person.person_cm_id === null) continue
    const pid = String(person.person_cm_id)
    if (pid === query) out.push({ score: 95, detail: `${person.name} · person ${pid}` })
    else if (pid.startsWith(query))
      out.push({ score: 55, detail: `${person.name} · person ${pid}` })
  }
  return out
}

function nameCandidates(household: ApiAidJumpHousehold, query: string): Candidate[] {
  const out: Candidate[] = []
  const family = fold(household.family_name)
  if (family.startsWith(query)) out.push({ score: 80, detail: 'family' })
  else if (family.includes(query)) out.push({ score: 40, detail: 'family' })
  for (const person of household.people) {
    const name = fold(person.name)
    const wordStart =
      name.startsWith(query) || name.split(/\s+/).some((word) => word.startsWith(query))
    if (wordStart) out.push({ score: 70, detail: `${person.role} ${person.name}` })
    else if (name.includes(query)) out.push({ score: 30, detail: `${person.role} ${person.name}` })
  }
  return out
}

function candidates(household: ApiAidJumpHousehold, query: string): Candidate[] {
  return /^\d+$/.test(query) ? idCandidates(household, query) : nameCandidates(household, query)
}

export function searchJumpIndex(
  households: readonly ApiAidJumpHousehold[],
  query: string,
  limit = 8
): JumpMatch[] {
  const q = fold(query.trim())
  if (q === '') return []
  const scored: Array<{ match: JumpMatch; score: number }> = []
  for (const household of households) {
    const found = candidates(household, q)
    if (found.length === 0) continue
    const best = found.reduce((a, b) => (b.score > a.score ? b : a))
    scored.push({
      score: best.score,
      match: {
        householdCmId: household.household_cm_id,
        familyName: household.family_name,
        detail: best.detail,
      },
    })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.match.familyName.localeCompare(b.match.familyName))
    .slice(0, limit)
    .map((entry) => entry.match)
}
