interface LegendItem {
  label: string
  color: string
}

interface ChartLegendProps {
  items: LegendItem[]
  className?: string
}

export function ChartLegend({ items, className = '' }: ChartLegendProps) {
  const compact = items.length > 6

  return (
    <div
      className={`flex flex-wrap justify-center ${compact ? 'gap-x-6 gap-y-1' : 'gap-4'} ${className}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className={`text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}
