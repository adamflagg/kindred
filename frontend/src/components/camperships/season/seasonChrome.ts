/**
 * The Season chrome (spec §4): one notice and one Approve panel for every tab. The page owns them; a tab reads the
 * context to show a save's notice, or to hold its edits while the panel is open.
 */
import { createContext, useContext } from 'react'

import type { ApiAidRulesSection } from '../../../types/api-types'

export interface SeasonChrome {
  readonly notice: string | null
  readonly setNotice: (text: string | null) => void
  /** The Approve panel is open: every Edit… waits ("Approve or cancel first."). */
  readonly approving: boolean
  /** Finance, live, and a rules draft with a section waiting. */
  readonly canApprove: boolean
  readonly openApprove: () => void
  readonly closeApprove: () => void
  /** The section the panel checks first (the tab's: Rules' ?section=, Rounds & budget's budget). */
  readonly section: ApiAidRulesSection
}

const NONE: SeasonChrome = {
  notice: null,
  setNotice: () => undefined,
  approving: false,
  canApprove: false,
  openApprove: () => undefined,
  closeApprove: () => undefined,
  section: 'budget',
}

export const SeasonChromeContext = createContext<SeasonChrome>(NONE)

export function useSeasonChrome(): SeasonChrome {
  return useContext(SeasonChromeContext)
}
