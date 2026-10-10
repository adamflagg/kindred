import { sessionName } from '../../../utils/sessionName'

/**
 * A session's name in a one-line cell (design-language §14, ruled 10-09): the tiny form for Family
 * Camp (FC1, WFC, RSC), "SCIT" for an SCIT session (owner 2026-10-10), the short form for everything
 * else (Session 2, AG 2 (7-8), a Quest whole). The full name always goes in the cell's title. `sessionType` is the record's `camp_sessions.session_type`;
 * a read that carries none ("" or undefined) is told apart by the name.
 */
export function aidSessionName(name: string, sessionType: string | undefined): string {
  if (name === '') return ''
  if (sessionType === 'scit') return SCIT
  const family = sessionType === 'family' || /^Family Camp \d/.test(name)
  return sessionName(name, family ? 'family' : sessionType, family ? 'tiny' : 'short')
}

/**
 * Counselor and Specialist In-Training, two CampMinder sessions of type scit, read as ONE "SCIT" in
 * Camperships (owner 2026-10-10, "approved to combine SCIT"), the full name on hover. Camperships
 * only: the app-wide #2790 vocabulary (CIT / SIT, sessionName.pins.test.ts) is untouched.
 */
export const SCIT = 'SCIT'

/** The unnumbered weekends the Camperships cell shortens a longer name to (the final mocks' NAMED_WEEKENDS). */
const NAMED_WEEKENDS = ['Winter Family Camp', 'Ready, Set, Camp'] as const

/**
 * The Camperships session cell's SHORT form (SessionNameCell; ux3 statistics-12): `sessionName`'s
 * short form, except that an SCIT session (or the shared SCIT row) is "SCIT", and that a family name
 * ENDING in a named weekend ("JFAM Winter Family Camp") is that weekend, as the final mock's sessForm
 * draws it, so it fits a one-line cell. Camperships only (coordinator 10-10): the app-wide `short`
 * keeps #2790's rule that an un-numbered family name stays whole.
 */
export function aidCellShortName(name: string, sessionType: string): string {
  if (sessionType === 'scit') return SCIT
  const named =
    sessionType === 'family' ? NAMED_WEEKENDS.find((weekend) => name.endsWith(weekend)) : undefined
  return named ?? sessionName(name, sessionType, 'short')
}

/**
 * A session's Camperships TINY form (Requests' Session cell, ruled 10-09): #2790's tiny, except that
 * SCIT is "SCIT".
 */
export function aidTinyName(name: string, sessionType: string): string {
  return sessionType === 'scit' ? SCIT : sessionName(name, sessionType, 'tiny')
}
