import { NavLink } from 'react-router'

import type { AidSection, AidTab } from '../../../config/aidNav'
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import { aidHref, type AidView } from '../kit/asOf'

/** A section's tabs, in the URL (§3.6), in SessionTabs' pill grammar; the season and as-of travel along. */
export function AidTabNav({
  section,
  tabs,
  view,
}: {
  section: AidSection
  tabs: readonly AidTab[]
  view: AidView
}) {
  return (
    <nav className={`${TAB_NAV} flex flex-wrap gap-1`}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.slug}
          to={aidHref(`${section.path}/${tab.slug}`, view)}
          className={({ isActive }) => (isActive ? TAB_PILL_ACTIVE : TAB_PILL_IDLE)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
