import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidApprovedRules, useAidRulesDraft } from '../../../hooks/camperships/useAidRules'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidRulesSection } from '../../../types/api-types'
import {
  CS_AMBER_NOTE,
  CS_BTN,
  CS_BTN2,
  CS_CARD,
  CS_CARD_HEADING,
  CS_FLABEL,
  CS_INPUT,
  CS_LINK,
  CS_PANEL,
  CS_PILL,
  CS_SMALL,
} from '../kit/csType'
import { approvedNotice } from './rules/approveWords'
import { ApproveForm } from './rules/ApproveForm'
import { draftSections } from './rules/rulesDraft'
import { SeasonChromeContext, UNLOCK_MS, useSeasonChrome, type SeasonChrome } from './seasonChrome'

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
  // Finance reads `season_done` off the draft; everyone else off the approved rules (spec §11.3).
  const approved = useAidApprovedRules(null, { enabled: !finance })
  const read = finance ? draft : approved
  const done = read.data?.season_done === true
  // A 503: the server couldn't read the dashboard's season, so it treats no season as open. Neither does the screen.
  const unreadable = hasStatus(read.error, 503) && !read.data ? read.error.message : null
  const [unlockedRaw, setUnlockedRaw] = useState<SeasonChrome['unlocked']>(null)
  // The unlock ends on a change of year and 30 minutes after it began, checked on every render as well as by timer.
  const unlocked =
    unlockedRaw !== null && unlockedRaw.year === year && Date.now() - unlockedRaw.at < UNLOCK_MS
      ? unlockedRaw
      : null
  useEffect(() => {
    if (unlockedRaw === null) return
    const timer = setTimeout(
      () => setUnlockedRaw(null),
      Math.max(0, unlockedRaw.at + UNLOCK_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [unlockedRaw])
  const [unlockingFor, setUnlockingFor] = useState<number | null>(null)
  const locked = unreadable !== null || (done && unlocked === null)
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
  const canApprove =
    live && !locked && draft.data !== undefined && draftSections(draft.data).length > 0
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
      done,
      locked,
      unreadable,
      unlocked,
      unlocking: unlockingFor === year && locked && unreadable === null,
      openUnlock: () => setUnlockingFor(year),
      closeUnlock: () => setUnlockingFor(null),
      unlock: (reason) => {
        setUnlockedRaw({ year, reason, at: Date.now() })
        setUnlockingFor(null)
      },
      lockAgain: () => setUnlockedRaw(null),
      pastSeasonReason: unlocked?.reason ?? null,
    }),
    [
      noticeFor,
      approvingFor,
      year,
      live,
      canApprove,
      editing,
      section,
      done,
      locked,
      unreadable,
      unlocked,
      unlockingFor,
    ]
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

/** The longest a reason runs in the tab bar's pill before a click is needed to read the rest. */
const PILL_REASON_CHARS = 32

/** The amber "Unlocked: ‹reason›" pill: truncated, and a click opens the whole reason (spec §11.3). */
function UnlockedPill({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false)
  const shown =
    open || reason.length <= PILL_REASON_CHARS
      ? reason
      : `${reason.slice(0, PILL_REASON_CHARS).trimEnd()}…`
  return (
    <button
      type="button"
      className={`${CS_PILL.amber} cursor-pointer`}
      onClick={() => setOpen(!open)}
    >
      {`Unlocked: ${shown}`}
    </button>
  )
}

/**
 * The tab bar's lock state, beside Approve… (spec §11.3): Unlock… for finance on a done season; the amber pill and
 * Lock Again once unlocked; the server's words when the season couldn't be read (nothing can unlock that).
 */
export function UnlockButton() {
  const { hasPermission } = usePermissions()
  const { done, unreadable, unlocked, unlocking, openUnlock, lockAgain } = useSeasonChrome()
  if (unreadable !== null) return <span className={CS_AMBER_NOTE}>{unreadable}</span>
  if (unlocked !== null) {
    return (
      <>
        <UnlockedPill reason={unlocked.reason} />
        <button type="button" className={CS_BTN2} onClick={lockAgain}>
          Lock Again
        </button>
      </>
    )
  }
  if (!done || unlocking || !hasPermission(Permission.FINANCIAL_AID_RULES)) return null
  return (
    <button type="button" className={CS_BTN2} onClick={openUnlock}>
      Unlock…
    </button>
  )
}

/** The Unlock panel, in the Approve panel's place (spec §11.3): one required reason, Back · Unlock. */
export function UnlockPanel() {
  const year = useYear()
  const { unlocking, closeUnlock, unlock } = useSeasonChrome()
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  if (!unlocking) return null
  return (
    <div className={`${CS_CARD} space-y-2`} data-testid="unlock-panel">
      <h3 className={CS_CARD_HEADING}>{`Unlock ${String(year)}`}</h3>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className={CS_FLABEL} htmlFor="unlock-reason">
          Why correct a done season?
        </label>
        <input
          id="unlock-reason"
          className={`${CS_INPUT} w-80`}
          value={reason}
          maxLength={2000}
          onChange={(event) => {
            setReason(event.target.value)
            setMissing(false)
          }}
        />
        {missing && <span className={CS_AMBER_NOTE}>A reason is required</span>}
      </div>
      <p className={CS_SMALL}>
        If you unlock: Edit… and Approve… come back for this visit. Every save and approval is
        logged with this reason.
      </p>
      <div className="flex gap-2">
        <button type="button" className={CS_BTN2} onClick={closeUnlock}>
          Back
        </button>
        <button
          type="button"
          className={CS_BTN}
          onClick={() => (reason.trim() === '' ? setMissing(true) : unlock(reason.trim()))}
        >
          Unlock
        </button>
      </div>
    </div>
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
