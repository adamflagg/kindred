/**
 * Shared cohort fixtures for the drill-down test surfaces
 * (CamperCohortsSection.test.tsx, IdentityPanel.test.tsx) — extracted so the
 * two files stop carrying diverging copies of the same shapes (#2539 scan).
 */
import type { CamperCohorts, CohortEntry } from '../hooks/useCamperCohorts'

/** A CohortEntry with an empty attendees array (attendee content is tested in useCamperCohorts.test.ts). */
export function cohortEntry(label: string, count: number): CohortEntry {
  return { label, count, attendees: [] }
}

/** A CamperCohorts fixture with default sessionType / allGenders. */
export function cohortsFixture(parts: {
  school?: CohortEntry | null
  congregation?: CohortEntry | null
  city?: CohortEntry | null
  sessionType?: string
  allGenders?: boolean
}): CamperCohorts {
  return {
    school: parts.school ?? null,
    congregation: parts.congregation ?? null,
    city: parts.city ?? null,
    sessionType: parts.sessionType ?? 'main',
    allGenders: parts.allGenders ?? false,
  }
}

/** One matched cohort attendee, fictional-name set per tests/CLAUDE.md. */
export function matchedAttendee(personCmId: number, firstName: string) {
  return {
    attendeeId: `a${personCmId}`,
    personCmId,
    firstName,
    lastName: 'Garcia',
    preferredName: null,
    grade: 7,
    gender: 'M',
  }
}
