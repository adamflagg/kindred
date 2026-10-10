import { useCallback, useEffect, useRef, useState } from 'react'

import {
  useAidApproveRules,
  useFreshAidRulesDraft,
} from '../../../../hooks/camperships/useAidRulesWrites'
import { useAidSessionNames } from '../../../../hooks/camperships/useAidSessionNames'
import { useYear } from '../../../../hooks/useCurrentYear'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type {
  ApiAidRulesApproveIn,
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidRulesVersion,
} from '../../../../types/api-types'
import { useOverlayEscape } from '../../../../hooks/useOverlayEscape'
import {
  CS_AMBER_NOTE,
  CS_BTN,
  CS_BTN2,
  CS_CARD,
  CS_CARD_HEADING,
  CS_FLABEL,
  CS_INPUT,
  CS_MUTED,
  CS_SMALL,
} from '../../kit/csType'
import { sectionChangeWords } from './approveWords'
import { approvePrecondition } from './precondition'
import { draftSections, sameSection, SECTION_ORDER } from './rulesDraft'
import { rulesVocabulary, SECTION_TITLES, type RulesNames } from './rulesModel'

/** What a re-read found: the version now, and the ticked sections that moved and were unticked. */
interface Recheck {
  readonly version: number
  readonly moved: readonly ApiAidRulesSection[]
  /** Ticked sections that gained validation errors: unticked too (the server refuses them). */
  readonly errored: readonly ApiAidRulesSection[]
  /** The server's 409 text, when the re-read followed one (plan review M4: the detail, not the lead). */
  readonly server: string | null
}

/** What an approval left behind, for the tab's notice. */
export interface Approved {
  /**
   * What the approval did to the pricing (interim, S8-⚠1): `moved`, this approval made the version
   * just approved the one pricing the season (`approved_version` was not it before, and is after);
   * `already`, it was the pricing version before (only sections that price nothing were waiting);
   * `waiting`, neither (or the refreshed draft couldn't be read): the cautious case.
   */
  readonly pricing: 'moved' | 'already' | 'waiting'
  /** The approval report's warnings, so they reach the approver. */
  readonly warnings: readonly string[]
}

const errorsOf = (draft: ApiAidRulesDraft, section: ApiAidRulesSection) =>
  draft.sections.find((s) => s.section === section)?.errors ?? 0

const reasonOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/**
 * Approve sections of the rules draft as one logged operation, with the approver's notes
 * (spec §7.5; D39; the note's wording is free text, O-930-7). A section with validation errors can't be
 * ticked (and is never pre-ticked: the server refuses to approve one). Nothing is approved unseen
 * (Decision 17, owner ruling 2026-10-02):
 * - the form opens on the draft as the server holds it now, not the cache;
 * - just before sending it reads the draft again, and if a ticked section moved it sends nothing,
 *   unticks every moved section and names them;
 * - the approval carries each ticked section's fingerprint, so a change in the instant between is
 *   refused (409) too, and a 409 re-reads the same way;
 * - a failed read says so; the form stays, and Approve or Cancel are always there.
 */
export function ApproveForm({
  initial,
  onDone,
  onBusyChange,
}: {
  /** The section open when the form opened; read once, so browsing the list never re-ticks. */
  initial: ApiAidRulesSection
  /** The approval's outcome, or null when cancelled. */
  onDone: (approved: Approved | null) => void
  /** Told when a submit starts and ends, so the page can keep the panel open through a tab switch. */
  onBusyChange?: (busy: boolean) => void
}) {
  const approve = useAidApproveRules()
  const sessions = useAidSessionNames(useYear())
  const fetchFresh = useFreshAidRulesDraft()
  const [seen, setSeen] = useState<ApiAidRulesDraft | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<ApiAidRulesSection>>(new Set())
  const [note, setNote] = useState('')
  const [recheck, setRecheck] = useState<Recheck | null>(null)
  // Busy from the click through every read and the write, until the form is done or refused.
  const [busy, setBusy] = useState(false)
  const [first] = useState(initial)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [error, setError] = useState<string | null>(null)
  const submitting = busy || approve.isPending
  useEffect(() => {
    onBusyChange?.(submitting)
    return () => onBusyChange?.(false)
  }, [submitting, onBusyChange])
  // Esc is Cancel (not while approving): the form is open from the first render, loaded or not.
  useOverlayEscape(true, () => {
    if (!busy && !approve.isPending) onDone(null)
  })

  const open = useCallback(() => {
    void fetchFresh().then(
      (fresh) => {
        setSeen(fresh)
        // Not pre-ticked with errors: its box is disabled, but a ticked one would still be sent.
        const row = fresh.sections.find((s) => s.section === first)
        setTicked(
          new Set(draftSections(fresh).includes(first) && (row?.errors ?? 0) === 0 ? [first] : [])
        )
      },
      (caught: unknown) => setError(`Couldn't load the rules draft: ${reasonOf(caught)}`)
    )
  }, [fetchFresh, first])
  useEffect(open, [open])

  if (seen === null) {
    return (
      <div className={`${CS_CARD} space-y-2`} data-testid="approve-form">
        {error === null ? (
          <p className={CS_MUTED}>Loading the rules draft as it is now…</p>
        ) : (
          <>
            <p className={CS_AMBER_NOTE}>{error}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={CS_BTN2}
                onClick={() => {
                  setError(null)
                  open()
                }}
              >
                Try Again
              </button>
              <button type="button" className={CS_BTN2} onClick={() => onDone(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  /** Move to the draft as read now, unticking every ticked section that changed since it was seen. */
  const reconcile = (fresh: ApiAidRulesDraft, server: string | null) => {
    const moved = SECTION_ORDER.filter((s) => ticked.has(s) && !sameSection(seen, fresh, s))
    const waiting = draftSections(fresh)
    const errored = SECTION_ORDER.filter(
      (s) => ticked.has(s) && !moved.includes(s) && errorsOf(fresh, s) > 0
    )
    // The boxes are held while busy, so `ticked` is what the person ticked.
    setTicked(
      new Set(
        [...ticked].filter((s) => !moved.includes(s) && !errored.includes(s) && waiting.includes(s))
      )
    )
    setSeen(fresh)
    setRecheck({ version: fresh.version, moved, errored, server })
    setBusy(false)
  }

  /** After the approval settled: does the version just approved now price the season? */
  const finish = async (
    version: number,
    before: number | null,
    report: ApiAidRulesVersion['report']
  ) => {
    let pricing: Approved['pricing'] = before === version ? 'already' : 'waiting'
    if (pricing === 'waiting') {
      try {
        if ((await fetchFresh()).approved_version === version) pricing = 'moved'
      } catch {
        // The notice takes the cautious sentence: it claims no re-pricing it couldn't see.
      }
    }
    if (!alive.current) return
    setBusy(false)
    onDone({
      pricing,
      warnings: (report.issues ?? []).filter((i) => i.severity === 'warning').map((i) => i.message),
    })
  }

  const submit = async () => {
    setRecheck(null)
    setError(null)
    setBusy(true)
    let fresh: ApiAidRulesDraft
    try {
      fresh = await fetchFresh()
    } catch (caught) {
      if (!alive.current) return
      setBusy(false)
      setError(
        `Couldn't check the rules draft is unchanged: ${reasonOf(caught)}. Nothing was approved.`
      )
      return
    }
    // The form may have closed during the read: then nothing is sent.
    if (!alive.current) return
    const sections = SECTION_ORDER.filter((s) => ticked.has(s))
    if (
      fresh.version !== seen.version ||
      sections.some((s) => !sameSection(seen, fresh, s) || errorsOf(fresh, s) > 0)
    ) {
      reconcile(fresh, null)
      return
    }
    const before = fresh.approved_version
    let body: ApiAidRulesApproveIn
    try {
      body = { sections, note: note.trim(), ...approvePrecondition(seen, sections) }
    } catch {
      // A section without a fingerprint: nothing can be sent, and the form must not stay busy.
      setBusy(false)
      setError("Couldn't send this approval: reload the rules and try again.")
      return
    }
    approve.mutate(
      { version: seen.version, body },
      {
        onSuccess: (approved) => void finish(seen.version, before, approved.report),
        onError: (caught) => {
          if (!hasStatus(caught, 409)) {
            setBusy(false)
            setError(caught.message)
            return
          }
          void fetchFresh().then(
            (latest) => {
              if (alive.current) reconcile(latest, caught.message)
            },
            (failed: unknown) => {
              if (!alive.current) return
              setBusy(false)
              setError(
                `${caught.message}. Nothing was approved, and the rules draft couldn't be read again: ${reasonOf(failed)}. Approve reads it again first.`
              )
            }
          )
        },
      }
    )
  }

  const toggle = (section: ApiAidRulesSection) =>
    setTicked((previous) => {
      const next = new Set(previous)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  const sections = draftSections(seen)
  const errorsIn = (section: ApiAidRulesSection) => errorsOf(seen, section)
  const working = busy || approve.isPending
  // A change names its pools, programs and sessions as the Rules tab does, not by their keys and ids.
  const vocabulary = rulesVocabulary((section) => seen.document[section], sessions)
  const namesFor = (section: ApiAidRulesSection): RulesNames => ({ section, ...vocabulary })

  return (
    <div className={`${CS_CARD} space-y-2`} data-testid="approve-form">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3
          className={CS_CARD_HEADING}
        >{`Approve sections of the rules draft (v${String(seen.version)})`}</h3>
        <span className={CS_SMALL}>
          {/* Owner 10-09: the promise holds only when every section is ticked. */}
          {sections.length > 0 && sections.every((section) => ticked.has(section))
            ? `Approving puts them in effect: v${String(seen.version)} then prices the season`
            : `Approving these sections: v${String(seen.version)} prices the season once every section is approved.`}
        </span>
      </div>
      {sections.length === 0 ? (
        <p className={CS_MUTED}>No section of the draft waits for approval.</p>
      ) : (
        <div className="space-y-1">
          {sections.map((section) => {
            const row = seen.sections.find((s) => s.section === section)
            return (
              <div key={section} className="flex min-w-0 flex-nowrap items-baseline gap-x-2">
                {/* The changes sit beside the label, not in it: a checkbox's name stays its section's title. */}
                <label className={`${CS_FLABEL} inline-flex items-baseline gap-x-2`}>
                  <input
                    type="checkbox"
                    checked={ticked.has(section)}
                    disabled={working || errorsIn(section) > 0}
                    onChange={() => toggle(section)}
                  />
                  {SECTION_TITLES[section]}
                </label>
                {row !== undefined && row.changes.length > 0 && (
                  <span
                    className={`${CS_SMALL} max-w-[60rem] min-w-0 truncate`}
                    title={sectionChangeWords(row.changes, namesFor(section))}
                  >
                    {sectionChangeWords(row.changes, namesFor(section))}
                  </span>
                )}
                {errorsIn(section) > 0 && (
                  <span className={CS_AMBER_NOTE}>fix its errors first</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {recheck !== null && (
        <div className="space-y-1" data-testid="approve-conflict">
          <p className={CS_AMBER_NOTE}>
            Someone else changed the rules draft since you looked. Nothing was approved.
          </p>
          {recheck.server !== null && <p className={CS_SMALL}>{recheck.server}</p>}
          <p className={CS_SMALL}>
            {`The rules draft is v${String(recheck.version)} now. `}
            {recheck.moved.length === 0 && recheck.errored.length === 0
              ? 'The sections you checked read as they did.'
              : ''}
            {recheck.moved.length > 0 &&
              `Changed since you looked, so unchecked: ${recheck.moved.map((s) => SECTION_TITLES[s]).join(', ')}. Look at them again before approving.`}
          </p>
          {recheck.errored.map((section) => (
            <p key={section} className={CS_SMALL}>
              {`${SECTION_TITLES[section]} now has errors and was unchecked.`}
            </p>
          ))}
        </div>
      )}
      {error !== null && <p className={CS_AMBER_NOTE}>{error}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className={CS_FLABEL} htmlFor="approve-note">
          Notes
        </label>
        <input
          id="approve-note"
          className={`${CS_INPUT} min-w-60 flex-1`}
          value={note}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
        <span className={CS_SMALL}>e.g. &ldquo;Board approved Apr 13&rdquo;</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={CS_BTN}
            disabled={working || ticked.size === 0 || note.trim() === ''}
            title={
              ticked.size === 0 || note.trim() === '' ? 'Check a section and add a note' : undefined
            }
            onClick={() => void submit()}
          >
            {working
              ? 'Approving…'
              : `Approve ${String(ticked.size)} ${ticked.size === 1 ? 'Section' : 'Sections'}`}
          </button>
          <button type="button" className={CS_BTN2} disabled={working} onClick={() => onDone(null)}>
            Cancel
          </button>
          <span className={CS_SMALL}>Esc cancels</span>
        </span>
      </div>
    </div>
  )
}
