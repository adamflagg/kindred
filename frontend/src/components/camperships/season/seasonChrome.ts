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
  /** An editor (a Rules card, the plan) is open: Approve… waits, so it never approves the old copy of unsaved text. */
  readonly editing: boolean
  readonly setEditing: (on: boolean) => void
  /** The Approve form is mid-submit: a tab switch leaves its panel open so the result notice lands. */
  readonly setApproveBusy: (busy: boolean) => void
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
  editing: false,
  setEditing: () => undefined,
  setApproveBusy: () => undefined,
  openApprove: () => undefined,
  closeApprove: () => undefined,
  section: 'budget',
}

export const SeasonChromeContext = createContext<SeasonChrome>(NONE)

export function useSeasonChrome(): SeasonChrome {
  return useContext(SeasonChromeContext)
}
