/**
 * MetricsSubNav - Secondary navigation for metrics sub-pages
 * Pattern: AreaFilterBar.tsx - segmented control inside container
 */
import { Link, useLocation } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { usePermissions } from '../../hooks/usePermissions'
import type { PermissionValue } from '../../constants/permissions'

export interface SubNavItem {
  id: string
  label: string
  icon: LucideIcon
  path: string
  permission?: PermissionValue
}

interface MetricsSubNavProps {
  items: SubNavItem[]
}

export default function MetricsSubNav({ items }: MetricsSubNavProps) {
  const location = useLocation()
  const { hasPermission } = usePermissions()

  const visibleItems = items.filter((item) => !item.permission || hasPermission(item.permission))

  // Determine active item based on current path
  const getActiveId = () => {
    for (const item of visibleItems) {
      if (location.pathname === item.path) {
        return item.id
      }
    }
    // Default to first item if no exact match
    return visibleItems[0]?.id ?? ''
  }

  const activeId = getActiveId()

  return (
    <nav className="border-border/50 border-b py-2.5">
      <div className="bg-muted/50 dark:bg-muted/30 border-border/50 flex w-fit items-center gap-1 rounded-xl border p-1">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeId === item.id
          return (
            <Link
              key={item.id}
              to={item.path + location.search}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
