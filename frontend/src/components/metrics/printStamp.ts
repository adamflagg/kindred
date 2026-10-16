const CAMP_TIME_ZONE = 'America/Los_Angeles'

/** "Thu Oct 15, 2026, 4:12 PM", in camp time. */
export function formatPrintStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}
