/**
 * CollapsibleSection - Expandable section for large data within detail panels.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-border border-t">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-2 text-left text-sm font-medium"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {title}
      </button>
      {isOpen && <div className="pb-3">{children}</div>}
    </div>
  )
}
