/**
 * Collapsible identity panel showing personal details
 * Birthday, school, location, gender identity, pronouns
 */
import { useState } from 'react';
import {
  User,
  ChevronDown,
  ChevronRight,
  Cake,
  School,
  MapPin,
} from 'lucide-react';
import { formatAge } from '../../utils/age';
import { formatGradeOrdinal } from '../../utils/gradeUtils';
import { getDisplayAgeForYear } from '../../utils/displayAge';
import { useYear } from '../../hooks/useCurrentYear';
import type { Camper } from '../../types/app-types';

interface IdentityPanelProps {
  camper: Camper;
  location: string | null;
  pronouns: string;
  defaultExpanded?: boolean;
}

export function IdentityPanel({
  camper,
  location,
  pronouns,
  defaultExpanded = false,
}: IdentityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const viewingYear = useYear();

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-6 py-4 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <User className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>
          <h2 className="text-lg font-display font-bold text-foreground">
            Identity & Details
          </h2>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="p-6 pt-4">
          {/* Personal Info Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="flex items-start gap-3">
              <Cake className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Birthday
                </dt>
                <dd className="text-sm mt-0.5 font-medium">
                  {camper.birthdate
                    ? new Date(camper.birthdate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'Not provided'}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {formatAge(getDisplayAgeForYear(camper, viewingYear) ?? 0)}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <School className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  School
                </dt>
                <dd className="text-sm mt-0.5 font-medium">
                  {camper.school || 'Not provided'}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {formatGradeOrdinal(camper.grade)} Grade
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Location
                </dt>
                <dd className="text-sm mt-0.5 font-medium">
                  {location || 'Not specified'}
                </dd>
              </div>
            </div>
          </div>

          {/* Identity Row */}
          <div className="pt-4 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-muted/30">
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
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

              <div className="p-4 rounded-xl bg-muted/30">
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Pronouns
                </dt>
                <dd className="text-sm font-medium">{pronouns}</dd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IdentityPanel;
