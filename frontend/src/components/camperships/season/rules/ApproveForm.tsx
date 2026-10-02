import { useCallback, useEffect, useState } from 'react'

import {
  useAidApproveRules,
  useFreshAidRulesDraft,
} from '../../../../hooks/camperships/useAidRulesWrites'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type { ApiAidRulesDraft, ApiAidRulesSection } from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD,
  LABEL,
} from '../../../admin/lodging/lodgingStyles'
import { approvePrecondition } from './precondition'
import { draftSections, sameSection, SECTION_ORDER } from './rulesDraft'
import { SECTION_TITLES } from './rulesModel'

/** What a re-read found: the version now, and the ticked sections that moved and were unticked. */
interface Recheck {
  readonly version: number
  readonly moved: readonly ApiAidRulesSection[]
  /** The server's 409 text, when the re-read followed one (plan review M4: the detail, not the lead). */
  readonly server: string | null
}

/** What an approval left behind, for the tab's notice. */
export interface Approved {
  /**
   * Whether the version just approved now prices the season: the refreshed draft's `approved_version`
   * is that version. Approving only some sections re-prices nothing (the server prices by the newest
   * version in which every pricing section is approved or locked). `false` too when the refreshed
   * draft couldn't be read: the cautious sentence.
   */
  readonly pricesSeason: boolean
  /** The approval report's warnings, so they reach the approver. */
  readonly warnings: readonly string[]
}

const reasonOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/**
 * Approve sections of the rules draft as one logged operation, with a note naming the approving body
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
}: {
  initial: ApiAidRulesSection
  /** The approval's outcome, or null when cancelled. */
  onDone: (approved: Approved | null) => void
}) {
  const approve = useAidApproveRules()
  const fetchFresh = useFreshAidRulesDraft()
  const [seen, setSeen] = useState<ApiAidRulesDraft | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<ApiAidRulesSection>>(new Set())
  const [note, setNote] = useState('')
  const [recheck, setRecheck] = useState<Recheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(() => {
    void fetchFresh().then(
      (fresh) => {
        setSeen(fresh)
        // Not pre-ticked with errors: its box is disabled, but a ticked one would still be sent.
        const row = fresh.sections.find((s) => s.section === initial)
        setTicked(
          new Set(
            draftSections(fresh).includes(initial) && (row?.errors ?? 0) === 0 ? [initial] : []
          )
        )
      },
      (caught: unknown) => setError(`Couldn't load the rules draft: ${reasonOf(caught)}`)
    )
  }, [fetchFresh, initial])
  useEffect(open, [open])

  if (seen === null) {
    return (
      <div className="card-lodge space-y-2 p-4" data-testid="approve-form">
        {error === null ? (
          <p className="text-muted-foreground text-sm">Loading the rules draft as it is now…</p>
        ) : (
          <>
            <p className={AMBER_NOTE}>{error}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={BUTTON_SECONDARY}
                onClick={() => {
                  setError(null)
                  open()
                }}
              >
                Try again
              </button>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => onDone(null)}>
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
    setTicked(new Set([...ticked].filter((s) => !moved.includes(s) && waiting.includes(s))))
    setSeen(fresh)
    setRecheck({ version: fresh.version, moved, server })
  }

  /** After the approval settled: does the version just approved now price the season? */
  const finish = async (version: number, report: unknown) => {
    let pricesSeason = false
    try {
      pricesSeason = (await fetchFresh()).approved_version === version
    } catch {
      // The notice takes the cautious sentence: it claims no re-pricing it couldn't see.
    }
    const issues = (report as { issues?: Array<{ severity: string; message: string }> } | null)
      ?.issues
    onDone({
      pricesSeason,
      warnings: (issues ?? []).filter((i) => i.severity === 'warning').map((i) => i.message),
    })
  }

  const submit = async () => {
    setRecheck(null)
    setError(null)
    setChecking(true)
    let fresh: ApiAidRulesDraft
    try {
      fresh = await fetchFresh()
    } catch (caught) {
      setError(
        `Couldn't check the rules draft is unchanged: ${reasonOf(caught)}. Nothing was approved.`
      )
      return
    } finally {
      setChecking(false)
    }
    const sections = SECTION_ORDER.filter((s) => ticked.has(s))
    if (fresh.version !== seen.version || sections.some((s) => !sameSection(seen, fresh, s))) {
      reconcile(fresh, null)
      return
    }
    approve.mutate(
      {
        version: seen.version,
        body: {
          sections,
          note: note.trim(),
          ...approvePrecondition(seen, sections),
        },
      },
      {
        onSuccess: (approved) => void finish(seen.version, approved.report),
        onError: (caught) => {
          if (!hasStatus(caught, 409)) {
            setError(caught.message)
            return
          }
          void fetchFresh().then(
            (latest) => reconcile(latest, caught.message),
            (failed: unknown) =>
              setError(
                `${caught.message}. Nothing was approved, and the rules draft couldn't be read again: ${reasonOf(failed)}. Approve reads it again first.`
              )
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
  const errorsIn = (section: ApiAidRulesSection) =>
    seen.sections.find((s) => s.section === section)?.errors ?? 0

  return (
    <div className="card-lodge space-y-2 p-4" data-testid="approve-form">
      <div className="text-sm font-medium">{`Approve sections of the rules draft (v${String(seen.version)})`}</div>
      {sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">No section of the draft waits for approval.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {sections.map((section) => (
            <label key={section} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={ticked.has(section)}
                disabled={errorsIn(section) > 0}
                onChange={() => toggle(section)}
              />
              {SECTION_TITLES[section]}
              {errorsIn(section) > 0 && <span className={AMBER_NOTE}>fix its errors first</span>}
            </label>
          ))}
        </div>
      )}
      <label className="block max-w-md">
        <span className={LABEL}>Approved by (the body, and when: “Finance, Jan 22 meeting”)</span>
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {recheck !== null && (
        <div className="space-y-1" data-testid="approve-conflict">
          <p className={AMBER_NOTE}>
            Someone else changed the rules draft since you looked. Nothing was approved.
          </p>
          {recheck.server !== null && (
            <p className="text-muted-foreground text-xs">{recheck.server}</p>
          )}
          <p className="text-xs">
            {`The rules draft is v${String(recheck.version)} now. `}
            {recheck.moved.length === 0
              ? 'The sections you ticked read as they did.'
              : `Changed since you looked, so unticked: ${recheck.moved.map((s) => SECTION_TITLES[s]).join(', ')}. Look at them again before approving.`}
          </p>
        </div>
      )}
      {error !== null && <p className={AMBER_NOTE}>{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={approve.isPending || checking || ticked.size === 0 || note.trim() === ''}
          onClick={() => void submit()}
        >
          {approve.isPending || checking
            ? 'Approving…'
            : `Approve ${String(ticked.size)} ${ticked.size === 1 ? 'section' : 'sections'}`}
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={approve.isPending}
          onClick={() => onDone(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
