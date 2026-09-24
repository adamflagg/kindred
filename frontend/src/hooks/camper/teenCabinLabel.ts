/**
 * Q9 cabin-label rule (owner ruling 2026-09-22, late) for CURRENT-year rows,
 * extended to adult programs by kindred#2812 and to family weekends by #2814:
 * `useCamperHistory`'s rows, which every journey surface shows, and the board
 * modal's quick-stats bar. The
 * prior-year half of the same rule runs on the server since kindred#2776
 * (`api/services/camper_journey_service.py`), off the same `teen_cabins`,
 * `adult_cabins` and `family_cabins` lists the journey endpoint passes through. A cabin
 * label is keyed `${year}:${sessionCmId}` off a person-housing weekend row.
 * Kept in its own module (not `fetchCamperJourney.ts`) so a consumer that
 * only needs the current-year rule doesn't have to import that much-mocked
 * module.
 */
import {
  isAdultSessionType,
  isFamilySessionType,
  isQuestSessionType,
  isTeenProgramType,
} from '../../utils/sessionTypePredicates'
import type { PersonHousingWeekendRow } from '../../types/lodging'

/** One cabin label, plus the as-typed string when it is worth showing. */
export interface CabinLabel {
  cabinName: string
  cabinNameRaw: string
}

/**
 * The as-typed string, but ONLY where it disagrees with the label already
 * shown. Absent raw or a raw that already IS the label means nothing to
 * offer.
 */
export function recordedIfDifferent(label: string, raw: string): string | undefined {
  return raw.length > 0 && raw !== label ? raw : undefined
}

/**
 * Server-named cabins keyed `${year}:${sessionCmId}` — the attributed adult
 * cabins, the TLI/SCIT cabins the registry resolves, and the household's
 * family-weekend cabins (same row shape).
 */
export function cabinsByWeekend(weekends: PersonHousingWeekendRow[]): Map<string, CabinLabel> {
  const map = new Map<string, CabinLabel>()
  for (const w of weekends) {
    const cabinName = (w.cabin_name ?? '').trim()
    const cabinNameRaw = (w.cabin_name_raw ?? '').trim()
    if (w.year !== undefined && w.session_cm_id !== undefined && cabinName.length > 0) {
      map.set(`${String(w.year)}:${String(w.session_cm_id)}`, { cabinName, cabinNameRaw })
    }
  }
  return map
}

/**
 * The server-named cabins a current-year row can read, each keyed
 * `${year}:${sessionCmId}` (`cabinsByWeekend`). One object rather than three
 * positional maps of the same type, which would swap silently.
 */
export interface ServerCabins {
  /** Registry-resolved TLI/SCIT cabins (Q9). */
  teen: Map<string, CabinLabel>
  /** Attributed adult-program cabins (kindred#2812). */
  adult: Map<string, CabinLabel>
  /** The household's cabin per family weekend (owner ruling 2026-09-24, on #2814). */
  family: Map<string, CabinLabel>
}

export interface CurrentYearCabin {
  bunkName?: string
  bunkNameRecorded?: string
}

/**
 * A CURRENT-year row's cabin. A TLI/SCIT session shows ONLY the
 * registry-resolved name from `teenCabins`, plus the as-typed string when it
 * disagrees — or nothing at all when the registry doesn't resolve it (a
 * program group like "SCIT A"/"TLI"). An adult-program session shows ONLY the
 * cabin the server attributed to that weekend, from `cabins.adult`, the same
 * way (kindred#2812) — or nothing while nobody has typed one. A family weekend
 * shows ONLY the household's cabin for it, from `cabins.family` — the cabin
 * a parent's row for the same weekend shows (owner ruling 2026-09-24, on
 * #2814) — or nothing. Never the raw CampMinder bunk, for any of the three:
 * for a family weekend that is the day group (kindred#2466). Quest never shows a cabin at all — its "bunk"
 * is a trip name, not housing. Every other session type keeps its raw bunk
 * name unchanged (main/embedded/ag's live cabin assignment is untouched by
 * this rule).
 */
export function currentYearCabin(
  sessionType: string | undefined,
  year: number,
  sessionCmId: number,
  rawBunkName: string | null | undefined,
  cabins: ServerCabins
): CurrentYearCabin {
  if (isQuestSessionType(sessionType)) return {}
  const serverNamed = isTeenProgramType(sessionType)
    ? cabins.teen
    : isAdultSessionType(sessionType)
      ? cabins.adult
      : isFamilySessionType(sessionType)
        ? cabins.family
        : undefined
  if (serverNamed) {
    const housing = serverNamed.get(`${String(year)}:${String(sessionCmId)}`)
    if (!housing) return {}
    const bunkNameRecorded = recordedIfDifferent(housing.cabinName, housing.cabinNameRaw)
    return {
      bunkName: housing.cabinName,
      ...(bunkNameRecorded !== undefined ? { bunkNameRecorded } : {}),
    }
  }
  return rawBunkName ? { bunkName: rawBunkName } : {}
}
