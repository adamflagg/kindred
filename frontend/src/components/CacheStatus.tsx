import { useIsFetching } from '@tanstack/react-query'

export default function CacheStatus() {
  const isFetching = useIsFetching()

  if (isFetching === 0) return null

  return (
    <div className="animate-fade-in fixed right-6 bottom-24 z-50">
      <div className="card-lodge shadow-lodge-lg flex items-center gap-3 px-4 py-2.5">
        <div className="spinner-lodge h-4 w-4" />
        <span className="text-foreground text-sm font-medium">Loading...</span>
      </div>
    </div>
  )
}
