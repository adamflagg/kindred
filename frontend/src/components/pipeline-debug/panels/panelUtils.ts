/** Shared utility functions for pipeline debug detail panels. */

/** Map a 0-1 confidence score to a badge color. */
export function confidenceColor(c: number): 'green' | 'amber' | 'red' {
  if (c >= 0.8) return 'green'
  if (c >= 0.5) return 'amber'
  return 'red'
}

/**
 * Safely render an unknown value as a human-readable string.
 * Prevents `[object Object]` from appearing in the UI by serializing
 * objects/arrays with JSON.stringify and passing through primitives.
 */
export function renderUnknownValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Objects, arrays, etc.
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
