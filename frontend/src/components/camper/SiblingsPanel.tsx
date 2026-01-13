/**
 * Sidebar panel showing enrolled siblings with links
 */
import { Link } from 'react-router';
import { Users, Home, Calendar, ChevronRight } from 'lucide-react';
import { getAvatarColor, getInitial } from '../../utils/avatarUtils';
import { formatAge } from '../../utils/age';
import { formatGradeOrdinal } from '../../utils/gradeUtils';
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay';
import { getDisplayAgeForYear } from '../../utils/displayAge';
import { useYear } from '../../hooks/useCurrentYear';
import type { SiblingWithEnrollment } from '../../hooks/camper/types';

interface SiblingsPanelProps {
  siblings: SiblingWithEnrollment[];
  isLoading: boolean;
  error: Error | null;
}

export function SiblingsPanel({ siblings, isLoading, error }: SiblingsPanelProps) {
  const viewingYear = useYear();

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-pink-500 to-rose-500 px-5 py-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5" />
          Siblings
        </h2>
      </div>
      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <span className="text-sm text-muted-foreground ml-2">
              Loading...
            </span>
          </div>
        ) : error ? (
          <div className="text-center py-4">
            <p className="text-sm text-red-500">Error loading siblings</p>
          </div>
        ) : siblings.length > 0 ? (
          <div className="space-y-3">
            {siblings.map((sibling) => (
              <Link
                key={sibling.id}
                to={`/summer/camper/${sibling.cm_id}`}
                className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-border transition-all group"
              >
                {/* Sibling avatar */}
                <div
                  className={`w-10 h-10 rounded-xl ${getAvatarColor(sibling.gender || '')} flex items-center justify-center flex-shrink-0`}
                >
                  <span className="text-sm font-display font-bold text-white">
                    {getInitial(sibling.first_name)}
                  </span>
                </div>

                {/* Sibling info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 transition-colors truncate">
                    {sibling.preferred_name || sibling.first_name}{' '}
                    {sibling.last_name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                      const age = getDisplayAgeForYear(sibling, viewingYear);
                      return age !== null ? formatAge(age) : '?';
                    })()}{' '}
                    • {formatGradeOrdinal(sibling.grade || 0)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                    {sibling.session && (
                      <>
                        <Calendar className="w-3 h-3" />
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
                        {sibling.session && <span className="mx-0.5">•</span>}
                        <Home className="w-3 h-3" />
                        <span>{sibling.bunkName}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-forest-600 transition-colors flex-shrink-0" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <Users className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No siblings enrolled</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SiblingsPanel;
