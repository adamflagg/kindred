import { Link, useLocation } from 'react-router'

import { visibleSections, type AidSection } from '../../../config/aidNav'
import { usePermissions } from '../../../hooks/usePermissions'

function isActive(section: AidSection, pathname: string): boolean {
  if (section.key === 'today') return pathname === '/aid' || pathname === '/aid/'
  return pathname === section.path || pathname.startsWith(`${section.path}/`)
}

/**
 * Camperships' nav (D7 as amended by D64 and D65): Today · Requests · Grants · Money · Season ·
 * Reports, each shown only to who may open it. No Campers link. Users · Manage are not here:
 * they live in the user menu for every program (owner ruling 2026-10-01).
 */
export function AidNavLinks() {
  const { pathname } = useLocation()
  const { hasPermission } = usePermissions()
  return (
    <>
      {visibleSections({ hasPermission }).map((section) => (
        <Link
          key={section.key}
          to={section.path}
          className={`nav-link-lodge ${isActive(section, pathname) ? 'active' : ''}`}
        >
          {section.label}
        </Link>
      ))}
    </>
  )
}
