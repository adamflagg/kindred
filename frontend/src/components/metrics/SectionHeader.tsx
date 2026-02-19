import type { LucideIcon } from 'lucide-react'

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description?: string
}

export function SectionHeader({ icon: Icon, title, description }: SectionHeaderProps) {
  return (
    <div className="mt-8 mb-2">
      <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
        <Icon className="text-primary h-5 w-5" />
        {title}
      </h2>
      {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
    </div>
  )
}
