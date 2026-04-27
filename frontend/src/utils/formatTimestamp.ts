export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const deltaMs = now.getTime() - then.getTime()
  const minutesFloor = Math.floor(deltaMs / 60_000)
  if (minutesFloor < 1) return 'just now'
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const formatted = then.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return formatted.replace(', ', ' at ')
}
