import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  CS_BODY,
  CS_BTN2,
  CS_LINK,
  CS_PILL,
  CS_SEG,
  CS_SEG_BUTTON,
  CS_SEG_OFF,
  CS_SEG_ON,
  CS_SMALL,
} from '../../kit/csType'

import { useSeasonChrome } from '../seasonChrome'
import { frozenFact } from './leadWords'

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
  | { kind: 'receipt'; words: string; backHref: string }
  | { kind: 'none' }

export function LeadLine({
  state,
  onAll,
  children,
}: {
  state: LeadState
  onAll: (open: boolean) => void
  children?: ReactNode
}) {
  const { done } = useSeasonChrome()
  // A done season says so to finance and the registrar both (spec §11.3).
  const doneSeason = done && <span className={CS_PILL.muted}>Done season</span>
  const folds = (
    <span className="ml-auto flex gap-2">
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
    const seg = (on: boolean, text: string, href: string) =>
      state.hold !== null ? (
        <span className={`${CS_SEG_BUTTON} ${on ? CS_SEG_ON : CS_SEG_OFF}`}>{text}</span>
      ) : (
        <Link to={href} replace className={`${CS_SEG_BUTTON} ${on ? CS_SEG_ON : CS_SEG_OFF}`}>
          {text}
        </Link>
      )
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="lead-switch" className={CS_SEG}>
          {seg(state.show === 'draft', draftWord, state.draftHref)}
          {seg(state.show === 'approved', inEffect, state.approvedHref)}
        </span>
        <span className={CS_SMALL}>
          {state.hold === 'edit'
            ? 'Save or cancel the edit first.'
            : state.hold === 'approve'
              ? 'Approve or cancel first.'
              : frozenFact(state.show, state.draftVersion, state.approvedVersion)}
        </span>
        {doneSeason}
        {children}
        {folds}
      </div>
    )
  }
  if (state.kind === 'registrar') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CS_BODY} text-muted-foreground`}>
          {state.version === null
            ? 'No version prices the season yet: each section shows its newest approved copy.'
            : `The approved rules: v${String(state.version)}, in effect and frozen.`}
        </span>
        {doneSeason}
        {folds}
      </div>
    )
  }
  if (state.kind === 'receipt') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CS_BODY} text-muted-foreground`}>{`${state.words}. `}</span>
        <Link to={state.backHref} className={CS_LINK}>
          The Rules as They Price the Season ›
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
