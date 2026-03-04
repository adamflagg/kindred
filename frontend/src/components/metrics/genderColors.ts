/** Shared gender color palette for metrics charts. */

export const GENDER_COLORS: Record<string, string> = {
  M: 'hsl(200, 70%, 50%)', // Blue
  F: 'hsl(340, 70%, 50%)', // Pink
  Unknown: 'hsl(0, 0%, 60%)', // Gray
}

const FALLBACK_COLOR = 'hsl(280, 60%, 50%)' // Purple

export function getGenderColor(gender: string): string {
  return GENDER_COLORS[gender] ?? FALLBACK_COLOR
}
