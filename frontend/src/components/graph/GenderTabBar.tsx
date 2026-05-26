import clsx from 'clsx'
import { type GenderScope, type GenderTab, scopeToTab, tabToScope } from './genderFilter'

export interface GenderTabBarProps {
  gender: GenderScope
  agAvailable: boolean
  onSelect: (scope: GenderScope) => void
}

export default function GenderTabBar({ gender, agAvailable, onSelect }: GenderTabBarProps) {
  const tabs: GenderTab[] = (['All', 'Boys', 'Girls'] as GenderTab[]).concat(
    agAvailable ? ['AG'] : []
  )
  const active = scopeToTab(gender)
  return (
    <div
      role="group"
      aria-label="Filter by gender"
      className="border-border bg-background hidden shrink-0 items-center gap-0.5 rounded-xl border p-0.5 sm:flex"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tabToScope(tab))}
          aria-pressed={active === tab}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            active === tab
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
