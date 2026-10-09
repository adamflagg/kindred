import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  CS_BTN2,
  CS_LINK_SM,
  CS_PILL,
  CS_SEG,
  CS_SEG_BUTTON,
  CS_SEG_OFF,
  CS_SEG_ON,
  CS_TOOLBAR_STATUS,
} from '../../kit/csType'

import { useSeasonChrome } from '../seasonChrome'
import { frozenFact, receiptTitle } from './leadWords'

/*
 * Words: spec §6.2 B, plus three the spec leaves out and the mock's leadLine() supplies (rules-v3.html,
 * lines 906–913): "Rules v‹n›" for a fully approved draft, "Save or cancel the edit first." while a card is
 * edited, and "nothing in effect yet · approving puts v‹n› in effect" for a first draft. See "Spec, mock and code
 * disagreements", item 10.
 */
export type LeadState =
  | {
      kind: 'finance'
      show: 'draft' | 'approved'
      draftVersion: number
      approvedVersion: number | null
      hold: 'edit' | 'approve' | null
      draftHref: string
      approvedHref: string
    }
  | { kind: 'registrar'; version: number | null }
  | { kind: 'receipt'; words: string; version: number; backHref: string }
  | { kind: 'none' }

/** The status slot's warning tone: a hold, or the discard question. */
const STATUS_WARN = CS_TOOLBAR_STATUS.replace(
  'text-muted-foreground',
  'text-amber-700 dark:text-amber-400'
)

export function LeadLine({
  state,
  onAll,
  asking = false,
  children,
}: {
  state: LeadState
  onAll: (open: boolean) => void
  /** The discard question is open: it takes the status slot, and Open All / Close All step aside (mock P.discardAsk). */
  asking?: boolean
  children?: ReactNode
}) {
  const { done } = useSeasonChrome()
  // A done season says so to finance and the registrar both (spec §11.3).
  const doneSeason = done && <span className={CS_PILL.muted}>Done season</span>
  const folds = asking ? null : (
    <span className="ml-auto flex shrink-0 gap-2">
      <button type="button" className={CS_BTN2} onClick={() => onAll(true)}>
        Open All
      </button>
      <button type="button" className={CS_BTN2} onClick={() => onAll(false)}>
        Close All
      </button>
    </span>
  )
  if (state.kind === 'finance') {
    const same = state.approvedVersion === state.draftVersion
    const draftWord = same
      ? `Rules v${String(state.draftVersion)}`
      : `Draft v${String(state.draftVersion)}`
    const inEffect =
      state.approvedVersion === null
        ? 'None in effect'
        : `v${String(state.approvedVersion)} in effect`
    const holdWords =
      state.hold === 'edit'
        ? 'Save or cancel the edit first.'
        : state.hold === 'approve'
          ? 'Approve or cancel first.'
          : null
    const seg = (on: boolean, text: string, href: string) =>
      state.hold !== null ? (
        <span
          title={holdWords ?? undefined}
          className={`${CS_SEG_BUTTON} ${on ? CS_SEG_ON : CS_SEG_OFF}`}
        >
          {text}
        </span>
      ) : (
        <Link to={href} replace className={`${CS_SEG_BUTTON} ${on ? CS_SEG_ON : CS_SEG_OFF}`}>
          {text}
        </Link>
      )
    const fact =
      holdWords ??
      (asking && state.approvedVersion !== null
        ? `Discard v${String(state.draftVersion)}? Changes since v${String(state.approvedVersion)} are lost.`
        : frozenFact(state.show, state.draftVersion, state.approvedVersion))
    return (
      <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
        <span data-testid="lead-switch" className={`${CS_SEG} shrink-0`}>
          {seg(state.show === 'draft', draftWord, state.draftHref)}
          {seg(state.show === 'approved', inEffect, state.approvedHref)}
        </span>
        <span
          className={holdWords !== null || asking ? STATUS_WARN : CS_TOOLBAR_STATUS}
          title={fact}
        >
          {fact}
        </span>
        {doneSeason}
        {children}
        {folds}
      </div>
    )
  }
  if (state.kind === 'registrar') {
    const words =
      state.version === null
        ? 'No version prices the season yet: each section shows its newest approved copy.'
        : `The approved rules: v${String(state.version)}, in effect and frozen.`
    return (
      <div className="flex min-w-0 flex-nowrap items-center gap-2 whitespace-nowrap">
        <span className={CS_TOOLBAR_STATUS} title={words}>
          {words}
        </span>
        {doneSeason}
        {folds}
      </div>
    )
  }
  if (state.kind === 'receipt') {
    // Owner item 13: one line, the status and a small link; the old 16px link wrapped the whole bar.
    return (
      <div className="flex min-w-0 flex-nowrap items-center gap-2 whitespace-nowrap">
        <span className={CS_TOOLBAR_STATUS} title={receiptTitle(state.version, state.words)}>
          {state.words}
        </span>
        <Link
          to={state.backHref}
          className={`${CS_LINK_SM} shrink-0`}
          title="Back to Season › Rules as it prices the season today"
        >
          Back to the rules in effect ›
        </Link>
        {folds}
      </div>
    )
  }
  // A season with no rules (spec §6.2 B, 2028): the switch with nothing to switch to; NoRulesYet follows it.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span data-testid="lead-switch" className={CS_SEG}>
        <span className={`${CS_SEG_BUTTON} ${CS_SEG_ON}`}>Rules draft</span>
        <span className={`${CS_SEG_BUTTON} ${CS_SEG_OFF}`}>None in effect</span>
      </span>
    </div>
  )
}
