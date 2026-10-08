import { Link } from 'react-router'

import { aidViewPath, type AidSection, type AidTab, type AidTabView } from '../../../config/aidNav'
import { GROUP, GROUP_BUTTON_OFF, GROUP_BUTTON_ON } from '../../admin/audit/auditStyles'
import { aidHref, type AidView } from '../kit/asOf'

/**
 * A tab's views (§3.6; slice 4 Decision 1): "This season · Year over year" under Statistics, "Report
 * · ZIP codes" under Development (Funding sources and Grantors are held by the owner, V). Links in the
 * URL; the season and the as-of travel along, as on the tabs.
 */
export function ReportViewNav({
  section,
  tab,
  views,
  current,
  view,
}: {
  section: AidSection
  tab: AidTab
  views: readonly AidTabView[]
  current: AidTabView | undefined
  view: AidView
}) {
  return (
    <nav className={`${GROUP} w-fit`}>
      {views.map((v) => (
        <Link
          key={v.slug}
          to={aidHref(aidViewPath(section, tab, v), view)}
          className={v.slug === current?.slug ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  )
}
