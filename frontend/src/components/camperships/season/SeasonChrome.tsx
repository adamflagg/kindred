import { useMemo, useState, type ReactNode } from 'react'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidRulesDraft } from '../../../hooks/camperships/useAidRules'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidRulesSection } from '../../../types/api-types'
import { CS_BTN2, CS_LINK, CS_PANEL, CS_SMALL } from '../kit/csType'
import { approvedNotice } from './rules/approveWords'
import { ApproveForm } from './rules/ApproveForm'
import { draftSections } from './rules/rulesDraft'
import { SeasonChromeContext, useSeasonChrome, type SeasonChrome } from './seasonChrome'

/**
 * The page's one notice and Approve panel (spec §4). Approve… shows for finance (`rules`), live (no past as_of),
 * while the rules draft has a section waiting; the registrar never sees it (D76). The notice belongs to the season it
 * was about, and stays until dismissed or the next action.
 */
export function SeasonChromeProvider({
  section,
  tab,
  children,
}: {
  section: ApiAidRulesSection
  /** The Season tab showing: a change closes an open Approve panel unless it is mid-submit. */
  tab: string
  children: ReactNode
}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { hasPermission } = usePermissions()
  const finance = hasPermission(Permission.FINANCIAL_AID_RULES)
  const draft = useAidRulesDraft({ enabled: finance })
  const [noticeFor, setNoticeFor] = useState<{ year: number; text: string } | null>(null)
  const [approvingFor, setApprovingFor] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [approveBusy, setApproveBusy] = useState(false)
  // Leaving a tab closes approve mode (the panel would be rebuilt, losing its ticks and text), except mid-submit.
  const [lastTab, setLastTab] = useState(tab)
  if (lastTab !== tab) {
    setLastTab(tab)
    if (!approveBusy) setApprovingFor(null)
  }
  const live = finance && asOf.kind !== 'past'
  const canApprove = live && draft.data !== undefined && draftSections(draft.data).length > 0
  const value = useMemo(
    (): SeasonChrome => ({
      notice: noticeFor?.year === year ? noticeFor.text : null,
      setNotice: (text) => setNoticeFor(text === null ? null : { year, text }),
      // Not tied to the draft: an approval that clears the last waiting section refreshes the draft before it
      // reports, and the panel must stay to show what it did. It closes on its own Done or Cancel.
      approving: approvingFor === year && live,
      canApprove,
      editing,
      setEditing,
      setApproveBusy,
      openApprove: () => {
        setNoticeFor(null)
        setApprovingFor(year)
      },
      closeApprove: () => setApprovingFor(null),
      section,
    }),
    [noticeFor, approvingFor, year, live, canApprove, editing, section]
  )
  return <SeasonChromeContext.Provider value={value}>{children}</SeasonChromeContext.Provider>
}

/** "Approve…" on the tab bar's right (spec §4: cs-btn2). Hidden while the panel is open or an editor is. */
export function ApproveButton() {
  const { canApprove, approving, editing, openApprove } = useSeasonChrome()
  if (!canApprove || approving || editing) return null
  return (
    <button type="button" className={CS_BTN2} onClick={openApprove}>
      Approve…
    </button>
  )
}

/** The Approve panel, at the top of the tab's content (Rules: under its lead line). */
export function ApprovePanel() {
  const year = useYear()
  const { approving, closeApprove, setNotice, setApproveBusy, section } = useSeasonChrome()
  if (!approving) return null
  return (
    <ApproveForm
      key={year}
      initial={section}
      onBusyChange={setApproveBusy}
      onDone={(approved) => {
        closeApprove()
        if (approved !== null) setNotice(approvedNotice(approved))
      }}
    />
  )
}

/** The Season notice (spec §4): one line, there until dismissed or the next action; never a toast or a banner. */
export function SeasonNotice() {
  const { notice, setNotice } = useSeasonChrome()
  if (notice === null) return null
  return (
    <p className={`${CS_PANEL} whitespace-pre-line`} data-testid="rules-notice">
      {notice}{' '}
      {/* cs-link inherits its size: the small span makes Dismiss 12px without a second size on the button. */}
      <span className={CS_SMALL}>
        <button type="button" className={CS_LINK} onClick={() => setNotice(null)}>
          Dismiss
        </button>
      </span>
    </p>
  )
}
