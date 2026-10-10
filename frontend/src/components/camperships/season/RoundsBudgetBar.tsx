/**
 * Round and amber-stripe fills shared with Scenarios' spend strip. The Budget and pool bars themselves are the kit's
 * AidShareBar and AidMeter now (kit/Cards.tsx), drawn from budgetCards' budgetBar and poolBar.
 */
export const AMBER_STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_3px,var(--color-amber-200)_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,var(--color-amber-400)_0_3px,var(--color-amber-800)_3px_6px)]'
/** Round 1 in primary, Round 2 at 55% into the card, Round 3 at 28% (budget-v9). */
const ROUND_FILL: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'bg-primary',
  2: 'bg-[color-mix(in_oklab,var(--color-primary)_55%,var(--color-card))]',
  3: 'bg-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-card))]',
}
export const ROUND_SWATCH = ROUND_FILL
