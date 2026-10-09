import {
  CalendarCheck,
  FileBarChart,
  Inbox,
  Landmark,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { Navigate, useParams } from 'react-router'

import { aidHref } from '../../components/camperships/kit/asOf'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { aidSection, resolveAidTab, type AidSectionKey } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import PermissionDeniedPage from '../PermissionDeniedPage'

const ICONS: Record<AidSectionKey, LucideIcon> = {
  today: Inbox,
  requests: ListChecks,
  money: Landmark,
  season: CalendarCheck,
  reports: FileBarChart,
}

/**
 * A Camperships section before its slice lands (spec §12.3; Decision 4): the band, the tabs this
 * user may see, and one line naming the slice that builds it. A bare or unknown tab goes to the
 * first visible one, keeping the season and the as-of; a known tab this user may not see is refused (D76).
 * Each slice replaces the body below the tabs and keeps the rest.
 */
export default function AidSectionPage({ section: key }: { section: AidSectionKey }) {
  const section = aidSection(key)
  const { tab } = useParams()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const resolved = resolveAidTab(section, tab, { hasPermission })
  if (resolved.kind === 'denied') return <PermissionDeniedPage />
  if (resolved.kind === 'first') {
    return <Navigate to={aidHref(`${section.path}/${resolved.tab.slug}`, { year, asOf })} replace />
  }
  const { tab: current, tabs } = resolved

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={ICONS[key]}
        title={section.label}
        subtitle={`Season ${String(year)}`}
        // Today shows counts of work, not money: no as-of on its band (D20).
        asOf={key === 'today' ? undefined : asOf}
      />
      {tabs.length > 0 && <AidTabNav section={section} tabs={tabs} view={{ year, asOf }} />}
      <div className="card-lodge text-muted-foreground p-6 text-sm">
        {current ? `${section.label} › ${current.label}` : section.label} is built in{' '}
        {section.builtIn}.
      </div>
    </div>
  )
}
