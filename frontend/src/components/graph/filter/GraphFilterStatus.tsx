interface GraphFilterStatusProps {
  unitCount: number
  bunkCount: number
  onClick: () => void
}

export default function GraphFilterStatus({
  unitCount,
  bunkCount,
  onClick,
}: GraphFilterStatusProps) {
  const isActive = unitCount > 0 || bunkCount > 0
  if (!isActive) return null

  const parts: string[] = []
  if (unitCount > 0) parts.push(`${unitCount} ${unitCount === 1 ? 'unit' : 'units'}`)
  if (bunkCount > 0) parts.push(`${bunkCount} ${bunkCount === 1 ? 'bunk' : 'bunks'}`)
  const text = `Filtered: ${parts.join(', ')}`

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-primary text-primary-foreground absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold shadow-md transition hover:opacity-90"
    >
      {text}
    </button>
  )
}
