/**
 * IntentTabs - Reusable tab bar for multi-intent phase detail panels.
 *
 * Renders a horizontal tab bar where each item has a target_name label.
 * Used by Phase2Detail and Phase3Detail.
 */

interface IntentTabsProps<T extends { target_name: string }> {
  items: T[]
  activeTab: number
  onTabChange: (idx: number) => void
}

export function IntentTabs<T extends { target_name: string }>({
  items,
  activeTab,
  onTabChange,
}: IntentTabsProps<T>) {
  if (items.length <= 1) return null

  return (
    <div className="border-border flex gap-1 border-b">
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={() => onTabChange(idx)}
          role="tab"
          aria-label={item.target_name}
          aria-selected={activeTab === idx}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === idx
              ? 'border-blue-500 text-blue-700 dark:text-blue-400'
              : 'text-muted-foreground hover:text-foreground border-transparent'
          }`}
        >
          {item.target_name}
        </button>
      ))}
    </div>
  )
}
