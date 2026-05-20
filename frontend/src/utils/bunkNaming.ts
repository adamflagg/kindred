/**
 * Shared bunk-naming helpers.
 *
 * Pure string predicates and sort-key extractors that classify a bunk by
 * name. Lived in BunkSocialGraphModal until the bunk-swap feature also
 * needed them — the modal-internal exports inverted the normal direction
 * (utils → component) and were marked `react-refresh/only-export-components`
 * because they were ostensibly test-only. Hoisting them here removes that
 * coupling so utility modules can depend on them cleanly.
 */

export const isAGBunkName = (name: string): boolean => /^AG(?:$|[\s-]|\d)/.test(name)

export const getBunkType = (name: string): 'G' | 'B' | 'AG' => {
  if (!name) return 'B'
  if (isAGBunkName(name)) return 'AG'
  if (name.startsWith('G-')) return 'G'
  if (name.startsWith('B-')) return 'B'
  return 'B'
}

export const extractSortKey = (name: string): { primary: number; secondary: string } => {
  if (name.includes('Alph')) return { primary: -2, secondary: name }
  if (name.includes('Bet')) return { primary: -1, secondary: name }
  const match = name.match(/[GB]-(\d+)/)
  if (match?.[1]) return { primary: parseInt(match[1], 10), secondary: name }
  return { primary: 999, secondary: name }
}
