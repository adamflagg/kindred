/** Shared gender color palette for metrics charts. */

export const GENDER_COLORS: Record<string, string> = {
  M: 'hsl(200, 70%, 50%)', // Blue
  Male: 'hsl(200, 70%, 50%)', // Blue
  F: 'hsl(340, 70%, 50%)', // Pink
  Female: 'hsl(340, 70%, 50%)', // Pink
  Unknown: 'hsl(0, 0%, 60%)', // Gray
}

/** Segment definitions for stacked bar charts with male/female breakdown. */
export const GENDER_SEGMENTS: Array<{ key: string; label: string; color: string }> = [
  { key: 'female_count', label: 'Female', color: 'hsl(350, 70%, 50%)' },
  { key: 'male_count', label: 'Male', color: 'hsl(200, 70%, 50%)' },
]

const FALLBACK_COLOR = 'hsl(280, 60%, 50%)' // Purple

export function getGenderColor(gender: string): string {
  return GENDER_COLORS[gender] ?? FALLBACK_COLOR
}
