import { Link } from 'react-router';
import { Home, Users, Link2, UsersRound, type LucideIcon } from 'lucide-react';
import type { ValidTab } from '../../utils/sessionUtils';

export interface TabItem {
  id: ValidTab;
  label: string;
  icon: LucideIcon;
}

interface CreateTabsOptions {
  camperCount: number;
  requestCount: number;
}

// eslint-disable-next-line react-refresh/only-export-components -- Utility function for tab creation
export function createTabs({ camperCount, requestCount }: CreateTabsOptions): TabItem[] {
  return [
    { id: 'bunks', label: 'Bunks', icon: Home },
    { id: 'campers', label: `Campers (${camperCount})`, icon: Users },
    { id: 'requests', label: `Requests (${requestCount})`, icon: Link2 },
    { id: 'friends', label: 'Graph', icon: UsersRound },
  ];
}

interface SessionTabsProps {
  sessionId: string;
  activeTab: ValidTab;
  camperCount: number;
  requestCount: number;
}

export default function SessionTabs({
  sessionId,
  activeTab,
  camperCount,
  requestCount,
}: SessionTabsProps) {
  const tabs = createTabs({ camperCount, requestCount });

  return (
    <nav className="py-2 border-b border-border/50">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              to={`/summer/session/${sessionId}/${tab.id}`}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                ${activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-forest-50/50 dark:hover:bg-forest-950/30'
                }
              `}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
