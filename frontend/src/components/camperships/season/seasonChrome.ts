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
  /** The season is earlier than the dashboard's configured one (spec §11.3). */
  readonly done: boolean
  /** Every edit and approval waits: a done season not unlocked, or a season the server couldn't read. */
  readonly locked: boolean
  /** The server's words when the rules read answered 503 (the configured season couldn't be read), else null. */
  readonly unreadable: string | null
  /** The unlock, for this year only and for one sitting (30 minutes); null while locked. */
  readonly unlocked: { readonly year: number; readonly reason: string; readonly at: number } | null
  /** The Unlock panel is open (spec §11.3): it takes the Approve panel's place. */
  readonly unlocking: boolean
  readonly openUnlock: () => void
  readonly closeUnlock: () => void
  readonly unlock: (reason: string) => void
  readonly lockAgain: () => void
  /**
   * Counts each Lock Again: an open editor closes when it moves (coordinator ruling: Lock Again is deliberate). The
   * 30 minutes running out moves nothing, so the typing survives an Unlock… again.
   */
  readonly relocks: number
  /** The reason while unlocked, else null: every rules write sends it as `past_season_reason`. */
  readonly pastSeasonReason: string | null
}

/** One sitting: an unlock ends this long after it begins. */
export const UNLOCK_MS = 30 * 60 * 1000

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
  done: false,
  locked: false,
  unreadable: null,
  unlocked: null,
  unlocking: false,
  openUnlock: () => undefined,
  closeUnlock: () => undefined,
  unlock: () => undefined,
  lockAgain: () => undefined,
  relocks: 0,
  pastSeasonReason: null,
}

export const SeasonChromeContext = createContext<SeasonChrome>(NONE)

export function useSeasonChrome(): SeasonChrome {
  return useContext(SeasonChromeContext)
}
