/**
 * The household page's own classes. Each card's stripe matches its chip (D32: sky / purple /
 * emerald). Every raw palette colour has its `dark:` partner.
 */
const STRIPE: Readonly<Record<number, string>> = {
  1: 'border-l-4 border-l-sky-400 dark:border-l-sky-500',
  2: 'border-l-4 border-l-purple-400 dark:border-l-purple-500',
  3: 'border-l-4 border-l-emerald-400 dark:border-l-emerald-500',
}

/** The fourth household onward wears the neutral stripe, as the chips do. */
export function stripeOf(chip: number): string {
  return STRIPE[chip] ?? 'border-l-border border-l-4'
}

export const SECTION_TITLE = 'font-display text-base font-semibold'
/** The family's share is the band's answer (D77): amber on the forest band. */
export const FAMILY_SHARE_INK = 'text-amber-300 dark:text-amber-300'
