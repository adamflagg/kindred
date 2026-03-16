/** Shared utility functions for pipeline debug detail panels. */

/** Map a 0-1 confidence score to a badge color. */
export function confidenceColor(c: number): 'green' | 'amber' | 'red' {
  if (c >= 0.8) return 'green'
  if (c >= 0.5) return 'amber'
  return 'red'
}
