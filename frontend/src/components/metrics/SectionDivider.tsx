interface SectionDividerProps {
  label: string
}

export function SectionDivider({ label }: SectionDividerProps) {
  return (
    <div className="border-border relative my-8 border-t pt-6">
      <span className="bg-background text-muted-foreground absolute -top-3 left-4 px-2 text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
    </div>
  )
}
