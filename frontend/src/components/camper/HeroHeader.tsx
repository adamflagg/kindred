/**
 * Hero header for camper detail page
 * Displays avatar, name, quick stats bar, and CampMinder link
 */
import { Link } from 'react-router';
import {
  ArrowLeft,
  ExternalLink,
  MapPin,
  Calendar,
  Home,
  TreePine,
} from 'lucide-react';
import { CampMinderIcon } from '../icons';
import { getAvatarColor, getInitial } from '../../utils/avatarUtils';
import { formatAge } from '../../utils/age';
import { formatGradeOrdinal } from '../../utils/gradeUtils';
import { getDisplayAgeForYear } from '../../utils/displayAge';
import { sessionNameToUrl } from '../../utils/sessionUtils';
import type { Camper } from '../../types/app-types';

interface HeroHeaderProps {
  camper: Camper;
  currentYear: number;
  location: string | null;
  sessionShortName: string;
  pronouns: string;
}

export function HeroHeader({
  camper,
  currentYear,
  location,
  sessionShortName,
  pronouns,
}: HeroHeaderProps) {
  return (
    <div className="bg-gradient-to-br from-forest-700 via-forest-800 to-forest-900 rounded-2xl shadow-lodge-lg overflow-hidden">
      {/* Back link */}
      <div className="px-6 pt-5">
        <Link
          to="/summer/campers"
          className="inline-flex items-center gap-1.5 text-sm text-forest-200 hover:text-white transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to All Campers
        </Link>
      </div>

      {/* Main hero content */}
      <div className="px-6 pb-6 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          {/* Avatar */}
          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl ${getAvatarColor(camper.gender)} flex items-center justify-center shadow-lg ring-4 ring-white/20 flex-shrink-0`}
          >
            <span className="text-3xl sm:text-4xl font-bold text-white font-display">
              {getInitial(camper.first_name || '')}
            </span>
          </div>

          {/* Name and details */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold text-white tracking-tight">
              {camper.first_name} {camper.last_name}
            </h1>
            {camper.preferred_name &&
              camper.preferred_name.replace(/^["']|["']$/g, '') !==
                camper.first_name && (
                <p className="text-forest-200 text-lg mt-0.5">
                  Goes by "{camper.preferred_name.replace(/^["']|["']$/g, '')}"
                </p>
              )}
            <p className="text-forest-100 mt-2 text-base sm:text-lg">
              {camper.gender === 'M'
                ? 'Male'
                : camper.gender === 'F'
                  ? 'Female'
                  : 'Non-Binary'}{' '}
              • {pronouns} • {formatAge(getDisplayAgeForYear(camper, currentYear) ?? 0)} •{' '}
              {formatGradeOrdinal(camper.grade)} Grade
            </p>
          </div>

          {/* CampMinder button */}
          <div className="flex-shrink-0">
            <a
              href={`https://system.campminder.com/ui/person/Record#${camper.person_cm_id}:${currentYear}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white dark:bg-amber-100 text-forest-800 dark:text-forest-900 rounded-xl hover:bg-forest-50 dark:hover:bg-amber-50 text-sm font-semibold shadow-lg hover:shadow-xl transition-all ring-1 ring-white/20 dark:ring-amber-200/50"
            >
              <CampMinderIcon className="w-5 h-5" />
              <span className="hidden sm:inline">View in CampMinder</span>
              <span className="sm:hidden">CampMinder</span>
              <ExternalLink className="w-4 h-4 opacity-60" />
            </a>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="bg-forest-900/50 backdrop-blur-sm border-t border-forest-600/30 px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {location && (
            <div className="flex items-center gap-2 text-forest-100">
              <MapPin className="w-4 h-4 text-forest-300" />
              <span className="text-sm">{location}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-forest-100">
            <TreePine className="w-4 h-4 text-forest-300" />
            <span className="text-sm">{camper.years_at_camp || 0} years at camp</span>
          </div>
          {camper.expand?.assigned_bunk && (
            <div className="flex items-center gap-2 text-forest-100">
              <Home className="w-4 h-4 text-forest-300" />
              <Link
                to={`/summer/session/${sessionNameToUrl(camper.expand?.session?.name || '')}/board`}
                className="text-sm hover:text-white transition-colors"
              >
                {camper.expand.assigned_bunk.name}
              </Link>
            </div>
          )}
          <div className="flex items-center gap-2 text-forest-100">
            <Calendar className="w-4 h-4 text-forest-300" />
            <span className="text-sm">{sessionShortName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroHeader;
