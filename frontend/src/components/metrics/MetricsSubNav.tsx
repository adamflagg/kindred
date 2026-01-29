/**
 * MetricsSubNav - Secondary navigation for metrics sub-pages
 * Pattern: AreaFilterBar.tsx - segmented control inside container
 */
import { Link, useLocation } from 'react-router';
import type { LucideIcon } from 'lucide-react';

export interface SubNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

interface MetricsSubNavProps {
  items: SubNavItem[];
}

export default function MetricsSubNav({ items }: MetricsSubNavProps) {
  const location = useLocation();

  // Determine active item based on current path
  const getActiveId = () => {
    for (const item of items) {
      if (location.pathname === item.path) {
        return item.id;
      }
    }
    // Default to first item if no exact match
    return items[0]?.id ?? '';
  };

  const activeId = getActiveId();

  return (
    <nav className="py-2.5 border-b border-border/50">
      <div className="flex items-center gap-1 bg-muted/50 dark:bg-muted/30 rounded-xl p-1 border border-border/50 w-fit">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeId === item.id;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
                ${isActive
                  ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
