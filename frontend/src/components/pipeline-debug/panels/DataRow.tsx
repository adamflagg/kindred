/**
 * DataRow - Key-value display row for detail panels.
 */

interface DataRowProps {
  label: string
  value: React.ReactNode
  mono?: boolean
}

export function DataRow({ label, value, mono = false }: DataRowProps) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={`text-sm text-gray-800 dark:text-gray-200 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

interface BadgeProps {
  label: string
  color?: 'green' | 'amber' | 'red' | 'blue' | 'gray'
}

const badgeStyles = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

export function Badge({ label, color = 'gray' }: BadgeProps) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${badgeStyles[color]}`}
    >
      {label}
    </span>
  )
}

interface PanelSectionProps {
  label: string
  children: React.ReactNode
}

/** Labeled section divider for Input / Action / Output structure in detail panels. */
export function PanelSection({ label, children }: PanelSectionProps) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase dark:text-gray-500">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
