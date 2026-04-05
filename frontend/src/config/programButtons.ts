import type { LucideIcon } from 'lucide-react'
import { TreePine, Home, BarChart3 } from 'lucide-react'
import type { Program } from '../contexts/ProgramContext'

export interface ProgramButtonConfig {
  program: Program
  icon: LucideIcon
  label: string
  dropdownLabel: string
  /** Color class for the trigger button icon (in the nav bar) */
  triggerColorClass: string
  /** Class applied to the desktop dropdown button when this program is active */
  activeClass: string
  /** Class applied to the desktop dropdown button when this program is inactive */
  inactiveClass: string
  /** Class applied to the mobile button when this program is active */
  mobileActiveClass: string
  /** Class applied to the mobile button when this program is inactive */
  mobileInactiveClass: string
}

export const PROGRAM_BUTTONS: ProgramButtonConfig[] = [
  {
    program: 'summer',
    icon: TreePine,
    label: 'Summer',
    dropdownLabel: 'Summer Bunking',
    triggerColorClass: 'text-amber-400',
    activeClass: 'bg-primary/10 text-primary',
    inactiveClass: 'hover:bg-muted/50 text-foreground',
    mobileActiveClass: 'bg-primary text-primary-foreground',
    mobileInactiveClass: 'bg-muted/50 text-foreground hover:bg-muted',
  },
  {
    program: 'weekend',
    icon: Home,
    label: 'Weekend',
    dropdownLabel: 'Weekend Housing',
    triggerColorClass: 'text-amber-400',
    activeClass: 'bg-accent/10 dark:text-accent text-amber-600',
    inactiveClass: 'hover:bg-muted/50 text-foreground',
    mobileActiveClass: 'bg-accent text-accent-foreground',
    mobileInactiveClass: 'bg-muted/50 text-foreground hover:bg-muted',
  },
  {
    program: 'analytics',
    icon: BarChart3,
    label: 'Analytics',
    dropdownLabel: 'Camp Analytics',
    triggerColorClass: 'text-sky-400',
    activeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    inactiveClass: 'hover:bg-muted/50 text-foreground',
    mobileActiveClass: 'bg-sky-500 text-white',
    mobileInactiveClass: 'bg-muted/50 text-foreground hover:bg-muted',
  },
]
