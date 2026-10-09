import { sessionName } from '../../../utils/sessionName'

/**
 * A session's name in a one-line cell (design-language §14, ruled 10-09): the tiny form for Family
 * Camp (FC1, WFC, RSC), the short form for everything else (Session 2, AG 2 (7-8), a Quest whole). The
 * full name always goes in the cell's title. `sessionType` is the record's `camp_sessions.session_type`;
 * a read that carries none ("" or undefined) is told apart by the name.
 */
export function aidSessionName(name: string, sessionType: string | undefined): string {
  if (name === '') return ''
  const family = sessionType === 'family' || /^Family Camp \d/.test(name)
  return sessionName(name, family ? 'family' : sessionType, family ? 'tiny' : 'short')
}
