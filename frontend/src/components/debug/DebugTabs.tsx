import { NavLink } from 'react-router'

const TABS = [
  { to: '/summer/debug/parse-analysis', label: 'Parse Analysis' },
  { to: '/summer/debug/prompt-editor', label: 'Prompt Editor' },
  { to: '/summer/debug/pipeline', label: 'Pipeline' },
  { to: '/summer/debug/solver', label: 'Solver Stats' },
] as const

export function DebugTabs() {
  return (
    <div className="border-border/70 mb-5 border-b" data-tour="debug-tabs">
      <nav className="flex gap-1 text-sm" aria-label="Debug tools">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `relative -mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-5 py-3 font-medium transition-all duration-200 ${
                isActive
                  ? 'border-forest-500 text-forest-700 dark:text-forest-400 bg-forest-50/50 dark:bg-forest-900/20'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
