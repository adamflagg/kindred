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
      <span className="text-muted-foreground shrink-0 text-xs font-medium">{label}</span>
      <span className={`text-foreground text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
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
  gray: 'bg-muted text-muted-foreground',
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
      <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
