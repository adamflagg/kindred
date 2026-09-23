/**
 * Hero header for camper detail page
 * Displays avatar, name, quick stats bar, and CampMinder link
 */
import { Link } from 'react-router'
import { ArrowLeft, ExternalLink, MapPin, Calendar, Home, TreePine } from 'lucide-react'
import { CampMinderIcon } from '../icons'
import { StatusBadge } from '../StatusBadge'
import { getAvatarColor, getInitial } from '../../utils/avatarUtils'
import { formatAge } from '../../utils/age'
import { formatGenderFull } from '../../utils/genderUtils'
import { formatGradeName } from '../../utils/gradeUtils'
import { getDisplayAgeForYear } from '../../utils/displayAge'
import { sessionNameToUrl } from '../../utils/sessionUtils'
import { journeyCountLabel } from '../../utils/journeyCountLabel'
import { isQuestSessionType } from '../../utils/sessionTypePredicates'
import type { JourneyCounts } from '../../hooks/camper/types'
import type { Camper } from '../../types/app-types'

interface HeroHeaderProps {
  camper: Camper
  enrolledCampers?: Camper[]
  currentYear: number
  location: string | null
  sessionShortName: string
  pronouns: string
  /** Additional session short names for multi-session persons */
  allSessionNames?: string[] | undefined
  /** The shared journey counts behind the count line — the same on every journey surface */
  journeyCounts: JourneyCounts
  /** True when every current-year enrollment is an adult program — adults have no grade */
  isAdultProgram?: boolean
}

export function HeroHeader({
  camper,
  enrolledCampers,
  currentYear,
  location,
  sessionShortName,
  pronouns,
  allSessionNames,
  journeyCounts,
  isAdultProgram,
}: HeroHeaderProps) {
  const countLabel = journeyCountLabel(journeyCounts)
  // Quest option A (owner ruling 2026-09-23): only used by the
  // single-enrollment cabin/trip chip below (the multi-enrollment branch
  // computes this per enrolled camper).
  const isSingleQuest = isQuestSessionType(camper.expand?.session?.session_type)
  const gradeLabel = formatGradeName(camper.grade_name)
  return (
    <div className="from-forest-700 via-forest-800 to-forest-900 shadow-lodge-lg overflow-hidden rounded-2xl bg-gradient-to-br">
      {/* Back link */}
      <div className="px-6 pt-5">
        <Link
          to="/campers"
          className="text-forest-200 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to All Campers
        </Link>
      </div>

      {/* Main hero content */}
      <div className="px-6 pt-4 pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {/* Avatar */}
          <div
            className={`h-20 w-20 rounded-2xl sm:h-24 sm:w-24 ${getAvatarColor(camper.gender)} flex flex-shrink-0 items-center justify-center shadow-lg ring-4 ring-white/20`}
          >
            <span className="font-display text-3xl font-bold text-white sm:text-4xl">
              {getInitial(camper.first_name ?? '')}
            </span>
          </div>

          {/* Name and details */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                {camper.first_name} {camper.last_name}
              </h1>
              <StatusBadge status={camper.attendee_status} />
            </div>
            {camper.preferred_name &&
              camper.preferred_name.replace(/^["']|["']$/g, '') !== camper.first_name && (
                <p className="text-forest-200 mt-0.5 text-lg">
                  Goes by "{camper.preferred_name.replace(/^["']|["']$/g, '')}"
                </p>
              )}
            <p className="text-forest-100 mt-2 text-base sm:text-lg">
              {formatGenderFull(camper.gender)} • {pronouns} •{' '}
              {formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)}
              {/* Adults have no grade. */}
              {isAdultProgram || !gradeLabel ? null : ` • ${gradeLabel}`}
            </p>
          </div>

          {/* CampMinder button */}
          <div className="flex-shrink-0">
            <a
              href={`https://system.campminder.com/ui/person/Record#${camper.person_cm_id}:${currentYear}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-forest-800 dark:text-forest-900 hover:bg-forest-50 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold shadow-lg ring-1 ring-white/20 transition-all hover:shadow-xl dark:bg-amber-100 dark:ring-amber-200/50 dark:hover:bg-amber-50"
            >
              <CampMinderIcon className="h-5 w-5" />
              <span className="hidden sm:inline">View in CampMinder</span>
              <span className="sm:hidden">CampMinder</span>
              <ExternalLink className="h-4 w-4 opacity-60" />
            </a>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="bg-forest-900/50 border-forest-600/30 border-t px-6 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {location && (
            <div className="text-forest-100 flex items-center gap-2">
              <MapPin className="text-forest-300 h-4 w-4" />
              <span className="text-sm">{location}</span>
            </div>
          )}
          {countLabel.length > 0 && (
            <div className="text-forest-100 flex items-center gap-2">
              <TreePine className="text-forest-300 h-4 w-4" />
              <span className="text-sm">{countLabel}</span>
            </div>
          )}
          {enrolledCampers && enrolledCampers.length > 1
            ? enrolledCampers
                .filter((ec) => ec.expand?.assigned_bunk)
                .map((ec) => {
                  const isQuest = isQuestSessionType(ec.expand?.session?.session_type)
                  return (
                    <div key={ec.id} className="text-forest-100 flex items-center gap-2">
                      {/* Quest option A (owner ruling 2026-09-23): CampMinder's
                          "bunk" for a Quest enrollment is the trip name, not a
                          cabin — no Home icon, and the text reads as the
                          trip/group rather than housing. The board link is
                          kept either way. */}
                      {isQuest ? null : <Home className="text-forest-300 h-4 w-4" />}
                      <Link
                        to={`/summer/session/${sessionNameToUrl(ec.expand?.session?.name ?? '')}/board`}
                        className="text-sm transition-colors hover:text-white"
                      >
                        {isQuest
                          ? `Quest · ${ec.expand?.assigned_bunk?.name}`
                          : ec.expand?.assigned_bunk?.name}
                      </Link>
                    </div>
                  )
                })
            : camper.expand?.assigned_bunk && (
                <div className="text-forest-100 flex items-center gap-2">
                  {isSingleQuest ? null : <Home className="text-forest-300 h-4 w-4" />}
                  <Link
                    to={`/summer/session/${sessionNameToUrl(camper.expand.session?.name ?? '')}/board`}
                    className="text-sm transition-colors hover:text-white"
                  >
                    {isSingleQuest
                      ? `Quest · ${camper.expand.assigned_bunk.name}`
                      : camper.expand.assigned_bunk.name}
                  </Link>
                </div>
              )}
          <div className="text-forest-100 flex items-center gap-2">
            <Calendar className="text-forest-300 h-4 w-4" />
            <span className="text-sm">
              {allSessionNames && allSessionNames.length > 1
                ? allSessionNames.join(', ')
                : sessionShortName}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HeroHeader
