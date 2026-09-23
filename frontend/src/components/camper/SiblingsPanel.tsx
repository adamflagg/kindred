/**
 * Sidebar panel showing enrolled siblings with links
 */
import { Fragment } from 'react'
import { Link } from 'react-router'
import { Users, Home, Calendar, ChevronRight } from 'lucide-react'
import { getAvatarColor, getInitial } from '../../utils/avatarUtils'
import { formatAge } from '../../utils/age'
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay'
import { getDisplayAgeForYear } from '../../utils/displayAge'
import { formatGradeName } from '../../utils/gradeUtils'
import { StatusBadge } from '../StatusBadge'
import { useYear } from '../../hooks/useCurrentYear'
import type { SiblingWithEnrollment } from '../../hooks/camper/types'

interface SiblingsPanelProps {
  siblings: SiblingWithEnrollment[]
  isLoading: boolean
  error: Error | null
  title?: 'Siblings' | 'Household'
}

export function SiblingsPanel({
  siblings,
  isLoading,
  error,
  title = 'Siblings',
}: SiblingsPanelProps) {
  const viewingYear = useYear()

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <div className="bg-gradient-to-r from-pink-500 to-rose-500 px-5 py-4">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
          <Users className="h-5 w-5" />
          {title}
        </h2>
      </div>
      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="border-muted border-t-primary h-5 w-5 animate-spin rounded-full border-2" />
            <span className="text-muted-foreground ml-2 text-sm">Loading...</span>
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-sm text-red-500">Error loading siblings</p>
          </div>
        ) : siblings.length > 0 ? (
          <div className="space-y-3">
            {siblings.map((sibling) => (
              <Link
                key={sibling.id}
                to={`/camper/${sibling.cm_id}`}
                className="bg-muted/30 hover:bg-muted/50 hover:border-border group flex items-center gap-3 rounded-xl border border-transparent p-3 transition-all"
              >
                {/* Sibling avatar */}
                <div
                  className={`h-10 w-10 rounded-xl ${getAvatarColor(sibling.gender || '')} flex flex-shrink-0 items-center justify-center`}
                >
                  <span className="font-display text-sm font-bold text-white">
                    {getInitial(sibling.first_name)}
                  </span>
                </div>

                {/* Sibling info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 truncate text-sm font-medium transition-colors">
                      {sibling.preferred_name || sibling.first_name} {sibling.last_name}
                    </span>
                    <StatusBadge status={sibling.attendeeStatus} />
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {(() => {
                      const age = getDisplayAgeForYear(sibling, viewingYear)
                      // The grade in the short style ("K", "Pre-K", "5th"), bare
                      // like the age; none without a grade name -- kindred#2779.
                      const parts = [
                        age !== null ? formatAge(age) : null,
                        formatGradeName(sibling.grade_name, 'short'),
                      ].filter((part): part is string => part !== null)
                      return parts.join(' • ')
                    })()}
                  </div>
                  {/* Owner ruling 2026-09-22 ("P3"): a session and its OWN
                      cabin get no separator between them — only a
                      transition to a DIFFERENT program does, and that
                      separator is a vertical bar, never a dot. A dot for
                      both left the cabin's owning program ambiguous once
                      more than one program was on the line
                      ("Session 3 • 🏠 B-7 • Family Camp 1"). */}
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                    {sibling.session && (
                      <>
                        <Calendar className="h-3 w-3" />
                        <span>
                          {getSessionDisplayNameFromString(
                            sibling.session.name,
                            sibling.session.session_type
                          )}
                        </span>
                      </>
                    )}
                    {sibling.bunkName && (
                      <>
                        <Home className="h-3 w-3" />
                        <span>{sibling.bunkName}</span>
                      </>
                    )}
                    {sibling.additionalSessions?.map((s, idx) => (
                      <Fragment key={`${s.name}-${String(idx)}`}>
                        <span className="text-border mx-1">|</span>
                        <span>{getSessionDisplayNameFromString(s.name, s.session_type)}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight className="text-muted-foreground group-hover:text-forest-600 h-4 w-4 flex-shrink-0 transition-colors" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-4 text-center">
            <Users className="text-muted-foreground/50 mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              {title === 'Household'
                ? 'No one else in this household is enrolled'
                : 'No siblings found'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SiblingsPanel
