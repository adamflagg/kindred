import { Inbox } from 'lucide-react'
import { useMemo } from 'react'

import { QueryGuard } from '../../components/QueryGuard'
import type { AidView } from '../../components/camperships/kit/asOf'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { todaySections } from '../../components/camperships/today/todayModel'
import { TodaySection } from '../../components/camperships/today/TodaySection'
import { useAidToday } from '../../hooks/camperships/useAidToday'
import { useYear } from '../../hooks/useCurrentYear'

/**
 * Today, `/aid` (§6.4; D24): every waiting queue, one dense line each, with no big-number rows. Its
 * counts and the lists they open come from the same server query (D21). Counts of work carry no
 * as-of (D20), and Today is live, so its links carry the season only.
 */
export default function AidTodayPage() {
  const year = useYear()
  const today = useAidToday()
  const view = useMemo((): AidView => ({ year, asOf: { kind: 'live' } }), [year])
  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={Inbox}
        title="Today"
        subtitle={`Season ${String(year)} · everything waiting, one line each`}
      />
      <QueryGuard
        isLoading={today.isLoading}
        error={today.data ? null : today.error}
        data={today.data}
        label="Today"
      >
        {(data) => {
          const sections = todaySections(data)
          if (sections.length === 0) {
            return (
              <div className="card-lodge text-muted-foreground p-6 text-sm">
                Your role has no queues here: Today&apos;s lines are for casework and finance.
              </div>
            )
          }
          return (
            <div className="space-y-4">
              {sections.map((section) => (
                <TodaySection key={section.title} section={section} view={view} />
              ))}
            </div>
          )
        }}
      </QueryGuard>
    </div>
  )
}
