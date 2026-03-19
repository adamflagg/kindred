import type { ComponentType } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'

interface SortIconProps {
  field: string
  activeField: string | null
  direction: 'asc' | 'desc'
  ascIcon?: ComponentType<{ className?: string }>
  descIcon?: ComponentType<{ className?: string }>
  inactiveIcon?: ComponentType<{ className?: string }> | null
  className?: string
  inactiveClassName?: string
}

export function SortIcon({
  field,
  activeField,
  direction,
  ascIcon: AscIcon = ArrowUp,
  descIcon: DescIcon = ArrowDown,
  inactiveIcon: InactiveIcon = null,
  className = 'h-3 w-3',
  inactiveClassName,
}: SortIconProps) {
  if (activeField !== field) {
    if (!InactiveIcon) return null
    return <InactiveIcon className={inactiveClassName ?? className} />
  }
  return direction === 'asc' ? (
    <AscIcon className={className} />
  ) : (
    <DescIcon className={className} />
  )
}
