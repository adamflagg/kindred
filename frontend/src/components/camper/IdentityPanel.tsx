/**
 * Collapsible identity panel showing personal details
 * Birthday, school, location, gender identity, pronouns
 */
import { useState } from 'react'
import { User, ChevronDown, ChevronRight, Cake, School, MapPin } from 'lucide-react'
import { formatAge } from '../../utils/age'
import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { getDisplayAgeForYear } from '../../utils/displayAge'
import { useYear } from '../../hooks/useCurrentYear'
import type { Camper } from '../../types/app-types'

interface IdentityPanelProps {
  camper: Camper
  location: string | null
  pronouns: string
  defaultExpanded?: boolean
}

export function IdentityPanel({
  camper,
  location,
  pronouns,
  defaultExpanded = false,
}: IdentityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const viewingYear = useYear()

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center justify-between px-6 py-4 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-100 p-2 dark:bg-sky-900/30">
            <User className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <h2 className="font-display text-foreground text-lg font-bold">Identity & Details</h2>
        </div>
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-5 w-5" />
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5" />
        )}
      </button>

      {isExpanded && (
        <div className="p-6 pt-4">
          {/* Personal Info Row */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <Cake className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Birthday
                </dt>
                <dd className="mt-0.5 text-sm font-medium">
                  {camper.birthdate
                    ? new Date(camper.birthdate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'Not provided'}
                </dd>
                <dd className="text-muted-foreground text-xs">
                  {formatAge(getDisplayAgeForYear(camper, viewingYear) ?? 0)}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <School className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  School
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{camper.school || 'Not provided'}</dd>
                <dd className="text-muted-foreground text-xs">
                  {formatGradeOrdinal(camper.grade)} Grade
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Location
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{location || 'Not specified'}</dd>
              </div>
            </div>
          </div>

          {/* Identity Row */}
          <div className="border-border border-t pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="bg-muted/30 rounded-xl p-4">
                <dt className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  Sex / Gender Identity
                </dt>
                <dd className="text-sm">
                  <span className="font-medium">
                    {camper.gender === 'M'
                      ? 'Male'
                      : camper.gender === 'F'
                        ? 'Female'
                        : 'Non-Binary'}
                  </span>
                  {' • '}
                  <span className="text-muted-foreground">
                    {camper.gender_identity_write_in &&
                    camper.gender_identity_write_in.trim() !== ''
                      ? camper.gender_identity_write_in
                      : camper.gender_identity_name || 'Not specified'}
                  </span>
                </dd>
              </div>

              <div className="bg-muted/30 rounded-xl p-4">
                <dt className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  Pronouns
                </dt>
                <dd className="text-sm font-medium">{pronouns}</dd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IdentityPanel
