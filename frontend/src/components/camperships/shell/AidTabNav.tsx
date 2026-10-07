import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

import type { AidSection, AidTab } from '../../../config/aidNav'
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import { aidHref, type AidView } from '../kit/asOf'

/**
 * A section's tabs, in the URL (§3.6), in SessionTabs' pill grammar; the season and as-of travel along. `right`
 * (Season, spec §4) sits on the same line after the tabs: actions never get a row of their own.
 */
export function AidTabNav({
  section,
  tabs,
  view,
  right,
}: {
  section: AidSection
  tabs: readonly AidTab[]
  view: AidView
  right?: ReactNode | undefined
}) {
  return (
    <nav className={`${TAB_NAV} flex flex-wrap items-center gap-1`}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.slug}
          to={aidHref(`${section.path}/${tab.slug}`, view)}
          className={({ isActive }) => (isActive ? TAB_PILL_ACTIVE : TAB_PILL_IDLE)}
        >
          {tab.label}
        </NavLink>
      ))}
      {right !== undefined && right !== null && (
        <div className="ml-auto flex items-center gap-2">{right}</div>
      )}
    </nav>
  )
}
