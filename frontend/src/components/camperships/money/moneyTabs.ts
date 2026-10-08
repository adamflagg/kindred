/**
 * Money's tabs (spec §8.1; D62; money-v2.html): each tab's one-line purpose, in the mock's words,
 * shown under the tab bar so a person knows what the tab is for before reading it (P-1).
 */
export type MoneyTab = 'ledger' | 'to-place' | 'sources'

export const MONEY_TAB_PURPOSE: Readonly<Record<MoneyTab, string>> = {
  ledger: "One row per family, plus finance's posted totals by program and source.",
  'to-place':
    'CampMinder aid lines that no single request explains. Attach each one to the right request.',
  sources: "Finance's list of CampMinder descriptions and how each one is classified.",
}

export const isMoneyTab = (slug: string): slug is MoneyTab => slug in MONEY_TAB_PURPOSE
