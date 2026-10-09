/** The title's words for a household-level session (Family Camp: one request per household). */
export const HOUSEHOLD_WORDS = 'household requests: each app is a household'

/** What a session's name cell says on hover: the full name always, plus the household rule on Family Camp. */
export function sessionNameTitle(name: string, sessionType: string): string {
  return sessionType === 'family' ? `${name} · ${HOUSEHOLD_WORDS}` : name
}
