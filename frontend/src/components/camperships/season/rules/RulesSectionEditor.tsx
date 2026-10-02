import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
  useAidSaveRulesSection,
  useFreshAidRulesDraft,
} from '../../../../hooks/camperships/useAidRulesWrites'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type {
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidSectionSaveIn,
} from '../../../../types/api-types'
import { AMBER_NOTE, BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { savePrecondition } from './precondition'
import { sectionContent } from './rulesDraft'
import { SECTION_TITLES, changeWords } from './rulesModel'
import { editKey, fieldName, sectionChanges, touches } from './sectionEdit'
import { SectionEditor } from './SectionEditor'

interface Opened {
  /** The draft as read when the editor opened (or when the person put their edit on a newer one). */
  readonly draft: ApiAidRulesDraft
  readonly content: Record<string, unknown>
}

/** Why nothing was saved: someone else's change, found by the check before sending or by a 409. */
type Refusal =
  | { readonly kind: 'loading'; readonly server: string | null }
  | { readonly kind: 'loaded'; readonly server: string | null; readonly fresh: ApiAidRulesDraft }
  | { readonly kind: 'failed'; readonly server: string | null; readonly reason: string }

const reasonOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/**
 * The section editor's rules home (spec §7.5; D39) and its answer when someone else changed the
 * section (Decision 16, owner ruling 2026-10-02).
 * - It opens on the draft as the server holds it now, not the cache.
 * - Before sending, it reads the draft again. If the section (or the draft's version) moved, nothing is
 *   sent: the typing stays, the editor says what changed, and offers to put the typing on the new draft.
 * - The save carries the section's fingerprint, so a save made in the instant between that read and
 *   the write is refused (409) too. A 409 reads the draft again the same way.
 * - If that read fails, it says so with "Try again"; the typing is kept and Cancel still leaves.
 * It never re-sends on its own.
 */
export function RulesSectionEditor({
  section,
  draft,
  onDone,
}: {
  section: ApiAidRulesSection
  /** The Rules tab's read of the rules draft: the section's status for the banner. */
  draft: ApiAidRulesDraft
  /** The saved draft, or null when cancelled. */
  onDone: (saved: ApiAidRulesDraft | null) => void
}) {
  const save = useAidSaveRulesSection()
  const fetchFresh = useFreshAidRulesDraft()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = draft.sections.find((s) => s.section === section)?.status.state ?? 'draft'

  const open = useCallback(() => {
    void fetchFresh().then(
      (fresh) => setOpened({ draft: fresh, content: sectionContent(fresh.document, section) }),
      (caught: unknown) => setOpenError(reasonOf(caught))
    )
  }, [fetchFresh, section])
  useEffect(open, [open])

  /** Read the draft again after a refusal; a failed read keeps the refusal open with "Try again". */
  const reload = useCallback(
    (server: string | null) => {
      setRefusal({ kind: 'loading', server })
      void fetchFresh().then(
        (fresh) => setRefusal({ kind: 'loaded', server, fresh }),
        (caught: unknown) => setRefusal({ kind: 'failed', server, reason: reasonOf(caught) })
      )
    },
    [fetchFresh]
  )

  if (opened === null) {
    return openError === null ? (
      <p className="text-muted-foreground text-sm">Loading the rules draft as it is now…</p>
    ) : (
      <div className="space-y-1" data-testid="rules-open-failed">
        <p className={AMBER_NOTE}>{`Couldn't load the rules draft: ${openError}`}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => {
              setOpenError(null)
              open()
            }}
          >
            Try again
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const moved = (fresh: ApiAidRulesDraft) =>
    fresh.version !== opened.draft.version ||
    sectionChanges(opened.content, sectionContent(fresh.document, section)).length > 0

  const onSave = async (content: Record<string, unknown>) => {
    setRefusal(null)
    setError(null)
    setChecking(true)
    let fresh: ApiAidRulesDraft
    try {
      fresh = await fetchFresh()
    } catch (caught) {
      setError(
        `Couldn't check the rules draft is unchanged: ${reasonOf(caught)}. Nothing was saved.`
      )
      return
    } finally {
      setChecking(false)
    }
    if (moved(fresh)) {
      setRefusal({ kind: 'loaded', server: null, fresh })
      return
    }
    let body: ApiAidSectionSaveIn
    try {
      body = {
        base_version: opened.draft.version,
        content,
        ...savePrecondition(opened.draft, section),
      }
    } catch {
      // A section without a fingerprint: nothing can be sent, and the person is told.
      setError("Couldn't send this save: reload the rules and try again.")
      return
    }
    save.mutate(
      { section, body },
      {
        onSuccess: (saved) => onDone(saved),
        onError: (caught) => {
          if (hasStatus(caught, 409)) reload(caught.message)
          else setError(caught.message)
        },
      }
    )
  }

  const banner = (mine: readonly string[][]) => {
    const notes: ReactNode[] = []
    if (status !== 'draft') {
      notes.push(
        <p key="in-use" className="text-muted-foreground text-xs">
          {status === 'locked'
            ? 'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'
            : 'Approved: saving may start a new version, and the approved rules in use stay as they are until it is approved.'}
        </p>
      )
    }
    if (refusal !== null) {
      notes.push(
        <div key="refused" className="space-y-1" data-testid="rules-conflict">
          {/* The UI's own sentence leads; the server's 409 text is the detail (plan review M4). */}
          <p className={AMBER_NOTE}>
            Someone else changed the rules draft since you opened this section. Nothing was saved;
            your typing is kept.
          </p>
          {refusal.server !== null && (
            <p className="text-muted-foreground text-xs">{refusal.server}</p>
          )}
          {refusal.kind === 'loading' && (
            <p className="text-muted-foreground text-xs">Loading what changed…</p>
          )}
          {refusal.kind === 'failed' && (
            <div className="flex items-center gap-2 text-xs">
              <span>{`Couldn't load what changed: ${refusal.reason}`}</span>
              <button
                type="button"
                className={BUTTON_SECONDARY}
                onClick={() => reload(refusal.server)}
              >
                Try again
              </button>
            </div>
          )}
          {refusal.kind === 'loaded' && (
            <Moved
              fresh={refusal.fresh}
              section={section}
              opened={opened.content}
              mine={mine}
              onRebase={() => {
                setOpened({
                  draft: refusal.fresh,
                  content: sectionContent(refusal.fresh.document, section),
                })
                setRefusal(null)
              }}
            />
          )}
        </div>
      )
    }
    return notes.length === 0 ? null : <div className="space-y-1">{notes}</div>
  }

  return (
    <SectionEditor
      opened={opened.content}
      heading={`Editing ${SECTION_TITLES[section]} in the rules draft (v${String(opened.draft.version)})`}
      banner={banner}
      saving={save.isPending || checking}
      // Saving stays off while a refusal is open: the person looks at what moved first.
      canSave={refusal === null}
      error={error}
      onSave={(content) => void onSave(content)}
      onCancel={() => onDone(null)}
    />
  )
}

/** What someone else changed in this section, what both changed, and "Put my edit on vN". */
function Moved({
  fresh,
  section,
  opened,
  mine,
  onRebase,
}: {
  fresh: ApiAidRulesDraft
  section: ApiAidRulesSection
  opened: Record<string, unknown>
  mine: readonly string[][]
  onRebase: () => void
}) {
  const theirs = sectionChanges(opened, sectionContent(fresh.document, section))
  // Overlap by `touches`, never by equality: a change inside a list is reported at the list's path.
  const both = theirs.filter((change) => mine.some((p) => touches(p, change.path)))
  return (
    <>
      <p className="text-xs">
        {`The rules draft is v${String(fresh.version)} now. `}
        {theirs.length === 0
          ? 'Nothing in this section changed since you opened it.'
          : 'Changed in this section since you opened it:'}
      </p>
      {theirs.length > 0 && (
        <ul className="text-xs">
          {theirs.map((change) => (
            <li key={editKey(change.path)}>{changeWords(change)}</li>
          ))}
        </ul>
      )}
      {both.length > 0 && (
        <p className={AMBER_NOTE}>
          You both changed {both.map((change) => fieldName(change.path)).join('; ')}: saving puts
          yours in place of theirs.
        </p>
      )}
      <button type="button" className={BUTTON_SECONDARY} onClick={onRebase}>
        {`Put my edit on v${String(fresh.version)}`}
      </button>
    </>
  )
}
