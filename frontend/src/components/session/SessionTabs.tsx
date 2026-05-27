import { Link } from 'react-router'
import { Home, Users, Link2, UsersRound, type LucideIcon } from 'lucide-react'
import type { ValidTab } from '../../utils/sessionUtils'
import SessionLastUploadChip from './SessionLastUploadChip'

export interface TabItem {
  id: ValidTab
  label: string
  icon: LucideIcon
}

interface CreateTabsOptions {
  camperCount: number
  requestCount: number
}

// eslint-disable-next-line react-refresh/only-export-components -- Utility function for tab creation
export function createTabs({ camperCount, requestCount }: CreateTabsOptions): TabItem[] {
  return [
    { id: 'bunks', label: 'Bunks', icon: Home },
    { id: 'campers', label: `Campers (${camperCount})`, icon: Users },
    { id: 'requests', label: `Requests (${requestCount})`, icon: Link2 },
    { id: 'friends', label: 'Graph', icon: UsersRound },
  ]
}

interface SessionTabsProps {
  sessionId: string
  activeTab: ValidTab
  camperCount: number
  requestCount: number
  canManage?: boolean
  sessionCmId?: number
  agSessionCmIds?: number[]
  sessionName?: string
}

export default function SessionTabs({
  sessionId,
  activeTab,
  camperCount,
  requestCount,
  canManage = true,
  sessionCmId,
  agSessionCmIds,
  sessionName,
}: SessionTabsProps) {
  const tabs = createTabs({ camperCount, requestCount }).filter(
    (tab) => tab.id !== 'requests' || canManage
  )

  return (
    <nav className="border-border/50 border-b py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.id}
              to={`/summer/session/${sessionId}/${tab.id}`}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-forest-50/50 dark:hover:bg-forest-950/30'
              } `}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </Link>
          )
        })}
        {sessionName !== undefined && (
          <SessionLastUploadChip
            sessionCmId={sessionCmId}
            agSessionCmIds={agSessionCmIds ?? []}
            sessionName={sessionName}
          />
        )}
      </div>
    </nav>
  )
}
