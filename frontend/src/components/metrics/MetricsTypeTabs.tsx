/**
 * MetricsTypeTabs - Primary navigation for metrics module
 * Pattern: SessionTabs.tsx - rounded pills with icons, route-based
 */
import { Link, useLocation } from 'react-router';
import { BarChart3, Users, TrendingUp, type LucideIcon } from 'lucide-react';

interface MetricTypeTab {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

const METRIC_TYPES: MetricTypeTab[] = [
  { id: 'registration', label: 'Registration', icon: BarChart3, path: '/metrics/registration' },
  { id: 'retention', label: 'Retention', icon: Users, path: '/metrics/retention' },
  { id: 'trends', label: 'Trends', icon: TrendingUp, path: '/metrics/trends' },
];

export default function MetricsTypeTabs() {
  const location = useLocation();

  // Determine active tab based on current path
  const getActiveTab = () => {
    for (const tab of METRIC_TYPES) {
      if (location.pathname.startsWith(tab.path)) {
        return tab.id;
      }
    }
    return 'registration';
  };

  const activeTab = getActiveTab();

  return (
    <nav className="py-2 border-b border-border/50">
      <div className="flex flex-wrap gap-1.5">
        {METRIC_TYPES.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                ${isActive
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
