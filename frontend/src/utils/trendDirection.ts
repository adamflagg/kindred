export type TrendDirection = 'up' | 'down' | 'neutral'

export function trendDirection(value: number | string): TrendDirection {
  const n = Number(value)
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'neutral'
}
