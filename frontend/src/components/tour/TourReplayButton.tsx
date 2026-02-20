import { HelpCircle } from 'lucide-react'
import type { TourId } from '../../tours/types'

interface TourReplayButtonProps {
  tourId: TourId | null
  onReplay: () => void
}

export function TourReplayButton({ tourId, onReplay }: TourReplayButtonProps) {
  if (!tourId) return null

  return (
    <button
      onClick={onReplay}
      aria-label="Replay tour"
      title="Replay page tour"
      className="text-muted-foreground hover:text-foreground hover:bg-parchment-200/50 dark:hover:bg-bark-800/30 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
    >
      <HelpCircle className="h-4 w-4" />
      Tour
    </button>
  )
}
